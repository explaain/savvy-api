const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})
const request = require('request')
const SlackBot = require('slackbots')
const RtmClient = require('@slack/client').RtmClient
const { WebClient } = require('@slack/client');

const put = require('101/put')
const clone = require('101/clone')

const Encrypt = require('../controller/db_encrypt.js');
const SlackAuthIndex = process.env.ALGOLIA_ORG_INDEX

const slack = require('../platforms/slack')

const verifySlack = token => {
  const verified = token === process.env.VERIFICATION_TOKEN
  logger.trace(verified ? '✔️ Slack Verification Token = Verified' : '📛 Slack Verification Token = Failed!!!')
  return verified
}

const Orgs = [] // These details are loaded and decrypted from the db, then stored locally here for ease of access
const getOrg = async teamID => {
  logger.trace(getOrg, teamID)
  if (Orgs[teamID])
    return Orgs[teamID]
  else {
    Orgs[teamID] = await Encrypt.getData(SlackAuthIndex, teamID)
    return Orgs[teamID]
  }
}
const getAllOrgs = async () => {
  logger.trace(getAllOrgs)
  const allOrgs = await Encrypt.getAllData(SlackAuthIndex)
  logger.trace('allOrgs:', allOrgs)
  logger.trace('Orgs:', Orgs)
  return allOrgs
}
const setOrg = async (teamID, org) => {
  logger.trace(setOrg, teamID, org)
  org.slack.teamID = teamID
  org.objectID = teamID
  Orgs[teamID] = org
  const orgToSave = clone(org)
  delete orgToSave.temp
  await Encrypt.addData(SlackAuthIndex, orgToSave)
  logger.trace('Orgs:', Orgs)
  return org
}
const setOrgProp = async (teamID, path, value) => {
  logger.trace(setOrgProp, teamID, path, value)
  const oldOrg = await getOrg(teamID)
  const newOrg = put(oldOrg, path, value)
  logger.trace('Orgs:', Orgs)
  return await setOrg(teamID, newOrg)
}

const getTempProp = async (teamID, propKey, newFunc) => {
  logger.trace(getTempProp, teamID, propKey, newFunc)
  const org = await getOrg(teamID)
  if (org.temp && org.temp[propKey]) {
    logger.trace('Orgs:', Orgs)
    return org.temp[propKey]
  }
  else {
    const propVal = newFunc(org.slack)
    setOrgProp(teamID, 'org.temp.' + propKey, propVal)
    logger.trace('Orgs:', Orgs)
    return propVal
  }
}
const getBot = teamID => getTempProp(teamID, 'bot', tokens => new SlackBot({token: tokens.__botAccessToken}))
const getRtm = teamID => getTempProp(teamID, 'rtm', tokens => new RtmClient(tokens.__botAccessToken))
const getWeb = teamID => getTempProp(teamID, 'web', tokens => new WebClient(tokens.__accessToken))

exports.oauth = function(req, res) {
  logger.trace('oauth', req)
	// When a user authorizes an app, a code query parameter is passed on the oAuth endpoint. If that code is not there, we respond with an error message
  if (!req.query.code) {
      res.status(500);
      res.send({"Error": "Looks like we're not getting code."});
      console.log("Looks like we're not getting code.");
  } else {
    // If it's there...

    // We'll do a GET call to Slack's `oauth.access` endpoint, passing our app's client ID, client secret, and the code we just got as query parameters.
    request({
      url: 'https://slack.com/api/oauth.access', //URL to hit
      qs: {code: req.query.code, client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET}, //Query string data
      method: 'GET', //Specify the method
    }, function (error, response, body) {
      const slackKeychain = JSON.parse(body)
      if (!slackKeychain.ok) {
        logger.trace(slackKeychain);
        logger.error(slackKeychain.error);
      } else {
				logger.trace("🤓 Bot was authorised", slackKeychain)

        const teamID = slackKeychain.team_id
        const org = {
          objectID: teamID,
          slack: {
            teamID: teamID,
            __accessToken: slackKeychain.access_token,
            __botUserID: slackKeychain.bot.bot_user_id,
            __botAccessToken: slackKeychain.bot.bot_access_token,
          }
        }
        getTeamInfo(teamID, org.slack)
        .then(teamInfo => {
          org.slack.name = teamInfo.name
          org.slack.domain = teamInfo.domain
          setOrg(teamID, org)
        }).then(result => {
          initateSlackBot(org.slack, { userID: slackKeychain.user_id })
          res.redirect(`https://${org.slack.domain}.slack.com/`)
        }).catch(e => {
          logger.error(e)
          res.json(e)
        })
      }
    })
  }
}



const initateSlackBot = async (slackTeam, onboarding) => {
	logger.trace(initateSlackBot, slackTeam)

	// create a bot
	const bot = new SlackBot({ token: slackTeam.__botAccessToken })
	const rtm = new RtmClient(slackTeam.__botAccessToken)
	rtm.start()

  try {
    await setOrgProp(slackTeam.teamID, 'temp', {
      bot: bot,
      rtm: rtm
    })
  } catch (e) {
    logger.error(e)
  }

  logger.debug(Orgs[slackTeam.teamID])
  logger.debug(Orgs)

	logger.info('New Slackbot connecting.')

  logger.debug(bot)

	bot.on('open', () => logger.info("Slackbot opened websocket."))
	bot.on('errror', () => logger.info("Slackbot 👺 ERR'D OUT while connecting."))
	bot.on('close', () => logger.info("Slackbot 👺 CLOSED a websocket."))

	bot.on('start', () => {
		logger.info('Slackbot has 🙏 connected to team ' + slackTeam.name)

    if (onboarding) {
      bot.postMessage(onboarding.userID, `Hello! Welcome to Savvy :)`)
    }
	})

	bot.on('message', async message => {
    const messageTypesToIgnore = ['hello', 'reconnect_url', 'presence_change', 'desktop_notification', 'user_typing', 'channel_joined']
    if (messageTypesToIgnore.indexOf(message.type) === -1 && message.subtype !== 'bot_message') {
      logger.trace('Slack event:', message)

      if (message.text && message.text.match(/^(<@\w+>)?\s*integration\S?\s*$/)) {
        logger.trace(slackTeam)
        const org = await getOrg(slackTeam.teamID)
        logger.trace(org)
        const messageData = {
          teamID: message.team,
          recipient: message.channel,
          text: 'Ready to connect up your Google Drive and become a Savvy power user? 🚀 Just go here: ' + org.name + '.heysavvy.com'
        }
        logger.trace(messageData)
        sendMessage(messageData)
      } else {
        // Should send data to Chatbot and return messages for emitting
        // TODO: Support postEphemeral(id, user, text, params) for slash commands
        slack.handleMessage(slackTeam, message)
      }

    }
	})
}


exports.interactive = function(req, res) {
	logger.trace('exports.interactive', req.body)

	var action = JSON.parse(req.body.payload)
  logger.trace('exports.interactive', action)
  if (!verifySlack(action.token)) return

  res.sendStatus(200)
  slack.interactive(action)
  // .then(result => {
  // })
}


exports.events = function(req, res) {
	// logger.trace('exports.events', req.body)
	// logger.trace('exports.events', req.body.payload)
	// logger.trace('exports.events', req.body.payload.token)
  // if (!verifySlack(req.body.payload.token)) return

  res.send({challenge: req.body.challenge})
}


const handleActionsFromSlackController = response => {
  logger.trace('acceptClientMessageFunction', response)
  switch (response.action) {
    case 'sendMessage':
      return sendMessage(response.data)
      break;
    case 'updateMessage':
      return updateMessage(response.data)
      break;
    case 'getMessageData':
      return getMessageData(response.data)
      break;
    case 'setTyping':
      return setTyping(response.data.team, response.data.channel, response.data.on)
      break;
  }
}

slack.acceptClientMessageFunction(handleActionsFromSlackController)

const setTyping = async (team, channel, on) => {
  logger.trace(setTyping, team, channel, on)
  logger.trace(111)
  const rtm = await getRtm(team)
  logger.trace(222)
  rtm.sendTyping(channel)
  logger.trace(333)
}

const sendMessage = async messageData => {
  logger.trace(sendMessage, messageData)
  logger.trace(JSON.stringify(messageData))
  const bot = await getBot(messageData.teamID)
  return bot.postMessage(
		// reaction.channel.id.charAt(0) === 'D' ? reaction.user.id : reaction.channel.id, // Identify by user OR by group
		// Actually, previous line should be resolved by callback_id specified in the initial message
		messageData.recipient,
		messageData.text,
    messageData.params
	)
}

const updateMessage = async messageData => {
  logger.trace(updateMessage, messageData)
  const bot = await getBot(messageData.teamID)
  return bot.updateMessage(
		// reaction.channel.id.charAt(0) === 'D' ? reaction.user.id : reaction.channel.id, // Identify by user OR by group
		// Actually, previous line should be resolved by callback_id specified in the initial message
		messageData.recipient,
		messageData.ts,
		messageData.text,
    messageData.params
	)
}

/**
 * Takes message id-related data and returns message data (docs: https://api.slack.com/methods/channels.history)
 *
 * @param  {Object} messageSpecs
 * @param  {String} messageSpecs.ts
 * @param  {String} messageSpecs.channel
 * @return {Object}
 */
const getMessageData = async (messageSpecs) => {
  logger.trace(getMessageData, messageSpecs)
  const web = await getWeb(messageSpecs.team)
  logger.trace(web)
  logger.trace(messageSpecs)
  const res = await web.channels.history(messageSpecs.channel, { latest: messageSpecs.ts, count: messageSpecs.count || 1, inclusive: true })
  logger.trace(res)
  if (res.ok && res.messages && res.messages.length) {
    const messageData = res.messages
    messageData.forEach(m => m.channel = messageSpecs.channel)
    logger.trace(messageData)
    return messageData
  } else {
    logger.error(res.error)
    return res.error
  }
}

/**
 * Takes team ID and returns team info (docs: https://api.slack.com/methods/team.info)
 *
 * @param  {String} teamID
 * @return {Object}
 */
const getTeamInfo = async (teamID, auth) => {
  logger.trace(getTeamInfo, teamID)
  const org = auth ? { slack: auth } : await getOrg(teamID)
  const web = new WebClient(org.slack.__botAccessToken)
  res = await web.team.info()
  if (res.ok) {
    const teamInfo = res.team
    teamInfo.teamID = teamInfo.id
    teamInfo.__botUserID = org.slack.__botUserID
    return teamInfo
  } else {
    logger.error(res.error)
    return res.error
  }
}

const bootUp = async () => {
  const allOrgs = await getAllOrgs()
  allOrgs.forEach(async org => {
    if (org.objectID && org.slack && org.slack.__botAccessToken) {
      setOrg(org.objectID, org)
      initateSlackBot(org.slack)
    }
  })
}

bootUp()
