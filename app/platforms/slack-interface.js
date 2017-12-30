const request = require('request')
const SlackBot = require('slackbots')
const RtmClient = require('@slack/client').RtmClient
const slack = require('../platforms/slack')

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})
// const debug = true;
// const logger = debug ? tracer.colorConsole({level: 'log'}) : {trace:()=>{},log:()=>{}};

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
      qs: {code: req.query.code, client_id: properties.slack_client_id, client_secret: properties.slack_client_secret}, //Query string data
      method: 'GET', //Specify the method
    }, function (error, response, body) {
      if (error) {
        console.log(error);
      } else {
				var slackKeychain = JSON.parse(body)
				console.log("🤓 Bot was authorised", slackKeychain)
        res.json(slackKeychain);

				// TODO: Store this token in an encrypted DB so we can bootstrap bots after server restart
				initateSlackBot(slackKeychain.bot)
      }
    })
  }
}



const initateSlackBot = function(thisBotKeychain) {
	logger.trace(initateSlackBot);

	// create a bot
	bot = new SlackBot({
	   token: thisBotKeychain.bot_access_token
	});
	rtm = new RtmClient(thisBotKeychain.bot_access_token);
	rtm.start();

	logger.log('New Slackbot connecting.')

	bot.on('open', () => logger.log("Slackbot opened websocket."))
	bot.on('errror', () => logger.log("Slackbot 👺 ERR'D OUT while connecting."))
	bot.on('close', () => logger.log("Slackbot 👺 CLOSED a websocket."))

	bot.on('start', () => {
		logger.log('Slackbot has 🙏 connected.')

		// TODO: Remove after debug
    bot.postMessageToChannel('bot-testing', `*I'm your personal mind-palace. Invite me to this channel and ask me to remember things :)*`, {
        icon_emoji: ':sparkles:'
    });
	});

	bot.on('message', (message) => {
		logger.trace('Slack event:', message)

		// Only listen for text messages... for now.
		if(message.type !== 'message') return false;

		// Should send data to Chatbot and return messages for emitting
		// TODO: Support postEphemeral(id, user, text, params) for slash commands
		rtm.sendTyping(message.channel)
		slack.handleMessage(thisBotKeychain, message)
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

// Dev bootstrap
initateSlackBot({
	bot_access_token: process.env.SLACK_BOT_USER_OAUTH_ACCESS_TOKEN,
	bot_user_id: process.env.SLACK_BOT_USER_ID
})

slack.acceptClientMessageFunction(response => new Promise((resolve, reject) => {
  logger.trace('acceptClientMessageFunction', response)
  bot.postMessage(
		// reaction.channel.id.charAt(0) === 'D' ? reaction.user.id : reaction.channel.id, // Identify by user OR by group
		// Actually, previous line should be resolved by callback_id specified in the initial message
		response.recipient,
		response.text,
    response.params
	).then(res => {
    resolve(res)
  }).catch(e => {
    logger.error(e)
    reject(e)
  })
}))
