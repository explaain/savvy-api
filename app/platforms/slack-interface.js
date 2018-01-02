const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'log'})
const request = require('request')
const SlackBot = require('slackbots')
const RtmClient = require('@slack/client').RtmClient
const { WebClient } = require('@slack/client');

const Encrypt = require('../controller/db_encrypt.js');
const SlackAuthIndex = process.env.ALGOLIA_SLACK_AUTH_INDEX

const slack = require('../platforms/slack')

const Orgs = [] // These details are loaded and decrypted from the db, then stored locally here for ease of access
const getOrgs = async teamID => {
  if (Orgs[teamID])
    return Orgs[teamID]
  else {
    Orgs[teamID] = await Encrypt.getData(SlackAuthIndex, teamID)
    return Orgs[teamID]
  }
}
const getAllOrgs = async () => {
  return await Encrypt.getAllData(SlackAuthIndex)
}
const setOrg = async (teamID, org) => {
  org.slack.teamID = teamID
  org.objectID = teamID
  Orgs[teamID] = org
  return await Encrypt.addData(SlackAuthIndex, org)
}

exports.oauth = function(req, res) {
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

				// TODO: Store this token in an encrypted DB so we can bootstrap bots after server restart
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
          initateSlackBot(org.slack)
          res.redirect(`https://${org.slack.domain}.slack.com/`)
        }).catch(e => {
          logger.error(e)
          res.json(e)
        })
      }
    })
  }
}



const initateSlackBot = function(slackTeam) {
	logger.trace(initateSlackBot, slackTeam)

	// create a bot
	bot = new SlackBot({
	   token: slackTeam.__botAccessToken
	})
	rtm = new RtmClient(slackTeam.__botAccessToken)
	rtm.start()

	logger.log('New Slackbot connecting.')

	bot.on('open', () => logger.log("Slackbot opened websocket."))
	bot.on('errror', () => logger.log("Slackbot 👺 ERR'D OUT while connecting."))
	bot.on('close', () => logger.log("Slackbot 👺 CLOSED a websocket."))

	bot.on('start', () => {
		logger.log('Slackbot has 🙏 connected to team ' + slackTeam.name)

		// // TODO: Remove after debug
    // bot.postMessageToChannel('bot-testing', `*I'm your personal mind-palace. Invite me to this channel and ask me to remember things :)*`, {
    //     icon_emoji: ':sparkles:'
    // });
	})

	bot.on('message', (message) => {
    const messageTypesToIgnore = ['hello', 'reconnect_url', 'presence_change', 'desktop_notification', 'user_typing']
    if (messageTypesToIgnore.indexOf(message.type) === -1 && message.subtype !== 'bot_message') {
      logger.trace('Slack event:', message)

      // Should send data to Chatbot and return messages for emitting
      // TODO: Support postEphemeral(id, user, text, params) for slash commands
      slack.handleMessage(slackTeam, message)
    }
	})
}


exports.quickreply = function(req, res) {
	logger.trace(exports.quickreply)

	var reaction = JSON.parse(req.body.payload)

  return slack.quickreply(reaction)
}


exports.events = function(req, res) {
	logger.trace('exports.events', req.body)

  res.send({challenge: req.body.challenge})
}


const handleActionsFromSlackController = response => {
  logger.trace('acceptClientMessageFunction', response)
  switch (response.action) {
    case 'sendMessage':
      return sendMessage(response.data)
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

const setTyping = (team, channel, on) => {
  rtm.sendTyping(channel)
}

const sendMessage = messageData => new Promise(function(resolve, reject) {
  bot.postMessage(
		// reaction.channel.id.charAt(0) === 'D' ? reaction.user.id : reaction.channel.id, // Identify by user OR by group
		// Actually, previous line should be resolved by callback_id specified in the initial message
		messageData.recipient,
		messageData.text,
    messageData.params
	).then(res => {
    resolve(res)
  }).catch(e => {
    logger.error(e)
    reject(e)
  })
})

/**
 * Takes message id-related data and returns message data (docs: https://api.slack.com/methods/channels.history)
 *
 * @param  {Object} messageSpecs
 * @param  {String} messageSpecs.ts
 * @param  {String} messageSpecs.channel
 * @return {Object}
 */
const getMessageData = async (teamID, messageSpecs) => {
  logger.trace(getMessageData, teamID, messageSpecs)
  const org = await getOrgs(teamID)
  const web = new WebClient(org.slack.__botAccessToken)
  const res = await web.channels.history(messageSpecs.channel, { latest: messageSpecs.ts, count: messageSpecs.count || 1, inclusive: true })
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
  const org = auth ? { slack: auth } : await getOrgs(teamID)
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
    Orgs[org.objectID] = org
    const teamInfo = await (org.slack.teamID)
    initateSlackBot(org.slack, teamInfo)
  })
}

bootUp()
