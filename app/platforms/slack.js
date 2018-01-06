const schedule = require('node-schedule')
const chrono = require('chrono-node')
const crypto = require("crypto")
const Q = require("q")
const sinon = require('sinon')

const chatbotController = require('../controller/chatbot')
const properties = require('../config/properties.js')

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'trace'})
// const debug = true
// const logger = debug ? tracer.colorConsole({level: 'debug'}) : {trace:()=>{},log:()=>{}}
// tracer.setLevel('error')

const handedDown = { clientMessageFunction: () => new Promise(function(resolve, reject) { resolve() }) }

if (process.env.NODE_ENV === "test") {
  const sandbox = sinon.sandbox.create()
  const makeMessage = text => {
    return {
      type: 'message',
      text: text,
      channel: 'C7BQBL138',
      user: 'U04NVHJFD',
      ts: '1514745075.000017',
      source_team: 'T04NVHJBK',
      team: 'T04NVHJBK'
    }
  }
  sandbox.stub(handedDown, 'clientMessageFunction').callsFake(request => new Promise(function(resolve, reject) {
		switch (request.action) {
			case 'getMessageData':
				switch (request.data.count) {
					case 1:
						resolve([
              makeMessage('testing testing')
            ])
						break
					case 2:
						resolve([
							makeMessage('My very important Answer'),
							makeMessage('My very important Question')
						])
						break
				}
				break
			default:
				resolve()
		}
  }))
}


var bot;

exports.acceptClientMessageFunction = function(messageFunction) {
	handedDown.clientMessageFunction = messageFunction
}

// For sending standalone messages
const sendClientMessage = (data) => new Promise(function(resolve, reject) {
	if (handedDown.clientMessageFunction) {
		handedDown.clientMessageFunction(data)
		.then(function(res) {
			resolve(res)
		}).catch(function(e) {
			logger.error(e)
			reject(e)
		})
	} else {
		const e = 'No clientMessageFunction defined'
		logger.error(e)
		reject(e)
	}
})

chatbotController.acceptClientMessageFunction((response) => {
	const d = Q.defer()
	handleResponseGroup(response)
	.then((res) => {
		d.resolve(res)
	}).catch((e) => {
		logger.error(e)
		d.reject(e)
	})
	return d.promise
})

function scopeMessage(botUserID, message) {
	switch (message.sender.channel.charAt(0)) {
		// it's a public channel
		case "C":
			message.channelType = "C";
			// message.sender = message.channel; // Address the channel/group, not the user.
			message.formsOfAddress = new RegExp(`<?@?(forgetmenot|${botUserID})>?[,\s ]*`,'i');
			break;
		// it's either a private channel or multi-person DM
		case "G":
			message.channelType = "G";
			// message.sender = message.channel; // Address the channel/group, not the user.
			message.formsOfAddress = new RegExp(`<?@?(forgetmenot|${botUserID})>?[,\s ]*`,'i');
			break;
		// it's a DM with the user
		case "D":
			message.channelType = "D";
			// message.sender = message.user;
			message.formsOfAddress = new RegExp(``,'i'); // listen to all messages
			break;
	}
	return message;
}

const transformMessage = function(teamInfo, message) {
	// DMs have a slightly different format.
	if(message.message) Object.assign(message, message.message)

	message.sender = {
		user: message.user,
		channel: message.channel || (message.item ? message.item.channel : ''),
		team: message.team || teamInfo.teamID
	}

	message = scopeMessage(teamInfo.__botUserID, message);

	console.log("🔧🔧⚙️🔬 Transforming an API-able message: ", message)

	return message
}

exports.handleMessage = (teamInfo, message) => {
	logger.trace('handleMessage', teamInfo, message)

	// * Transform the message so the bot replies to the right user/channel etc.
	// * Get rid of unwanted addressing (e.g. @forgetmenot)
	message = transformMessage(teamInfo, message)

	switch (message.type) {
		case 'message':
			// Respond only when the bot's involved
			// But not if it's the bot posting.
 			if (message.subtype !== 'message_deleted' && (!message.text || message.formsOfAddress.test(message.text)) && !message.bot_id)
				return messageReceived(message)
		case 'quick_reply': // ???
			// ???
			break
		case 'reaction_added':
			if (message.reaction === 'paperclip')
				return reactionAdded(teamInfo, message, false)
			if (message.reaction === 'linked_paperclips')
				return reactionAdded(teamInfo, message, true)
		default:
			console.log('Not a message for me! Ignoring this one.')
			return new Promise((resolve, reject) => { resolve() })
	}
}

const setTyping = message => sendClientMessage({
		action: 'setTyping',
		data: {
			team: message.team,
			channel: message.channel,
			on: true
		}
	})

const messageReceived = message => {
	console.log('😈 CHATBOT listens to:', message)
	setTyping(message)
	// Remove reference to @forgetmenot
	if(message.text) message.text = message.text.replace(message.formsOfAddress, '')
	return packageAndHandleMessage(message)
}

const reactionAdded = async (teamInfo, message, includeTitle) => {
	// Get message ID
	const messageID = message.item.ts
	// Get message data
	const messageSpecs = {
		team: teamInfo.team,
		channel: message.item.channel,
		ts: message.item.ts,
		count: includeTitle ? 2 : 1
	}
	var messageData = await getMessageBySpecs(messageSpecs)
	const newMessage = transformMessage(teamInfo, messageData[0])
	logger.trace('newMessage', newMessage)
	// Save message to database
	const context = { intent: 'storeMemory' }
	if (includeTitle) context.title = messageData[1].text
	return await packageAndHandleMessage(newMessage, context)
}

const packageAndHandleMessage = (message, context) => new Promise((resolve, reject) => {
	logger.trace(packageAndHandleMessage, message, context)
	// Transform into Facebook format.
	var messagePackage = { entry: [ { messaging: [ {
		sender: message.sender,
		message: { },
		platform: 'slack'
	} ] } ] }

	if(message.text) {
		messagePackage.entry[0].messaging[0].message.text = message.file && message.file.initial_comment ? message.file.initial_comment.comment : message.text;
		// Message, or if a file, use file comments rather than fugly long Slack strings
		message.text = message.text.replace(message.formsOfAddress,'');
	}

	if(message.quick_reply) {
		messagePackage.entry[0].messaging[0].message.quick_reply = {
			payload: message.quick_reply
		}
	}

	messagePackage.entry[0].messaging[0].context = context

	// Package it up, add it to the messages for API to figure out.
	if(message.file) {

		var fileTypes = {
			jpg: "image",
			jpeg: "image",
			png: "image"
		}
		var type = fileTypes[message.file.filetype] ? fileTypes[message.file.filetype] : "fallback"

		messagePackage.entry[0].messaging[0].message.attachments = [{
			type: type,
			url: message.file.permalink,
			payload: {
				url: message.file.permalink
			}
		}]


		// // NB: this is packaged as the second in a two-part message array.
		// // TODO: Have chatbot **automatically** treat this message[1]
		// //	as the attachment of the "PREVIOUS" message (i.e. message[0])
		// messagePackage.entry[0].messaging.push({
		// 	sender: { id: message.channel },
		// 	message: {
		// 		attachments: [{
		// 			type: type,
		// 			url: message.file.permalink,
		// 			payload: {
		// 				url: message.file.permalink
		// 			}
		// 		}]
		// 	}
		// })
		console.log("Packaged a file")
	}

	logger.trace("TO API==>", JSON.stringify(messagePackage, null, 2))

  chatbotController.handleMessage(messagePackage)
  .then(function(apiResult) {
    logger.trace("FROM API==>", apiResult && apiResult.messageData ? JSON.stringify(apiResult.messageData, null, 2) : "No response text.")
    return handleResponseGroup(apiResult)
  }).then(res => {
		resolve(res)
	})
	.catch(function(e) {
    logger.error(e)
		reject(e)
  })
})

function handleResponseGroup(response) {
	logger.trace(handleResponseGroup, response)
  const d = Q.defer();
  const promises = response && response.messageData ? response.messageData.map(function(singleResponse) {
    singleResponse.data.message.moreResults = response.requestData.moreResults
		logger.trace(singleResponse.data)
		return sendResponseAfterDelay(singleResponse.data, (singleResponse.delay || 0) * 1000)
	}) : []
  Promise.all(promises)
  .then(function(res) {
    d.resolve(res)
  }).catch(function(e) {
    logger.error(e)
    d.reject(e)
  })
  return d.promise;
}

function sendResponseAfterDelay(thisResponse, delay) {
	logger.trace(sendResponseAfterDelay, thisResponse, delay)
  logger.trace(JSON.stringify(thisResponse))
	const d = Q.defer();

  try {

  	// For push-reminders where Chatbot specifies recipient.id
  	// Otherwise, look for `channel.id` and `channel` (the format for different Slack event types vary)
  	// thisResponse.recipient = thisResponse.recipient.id || thisResponse.channel.id || thisResponse.channel;
  	// rtm.sendTyping(emitter.recipient)

  	var params = {
  		attachments: []
  	}

  	if(thisResponse.message.attachment && thisResponse.message.attachment.payload) {
  		if(thisResponse.message.attachment.payload.elements) {
  			logger.trace("Displaying a list of attachments")

  			params.attachments.push({
          "fallback": "Here's a list of related memories.",
  				"pretext": "",
          "footer": "Related reminders"
  			})

  			thisResponse.message.attachment.payload.elements.forEach(memory => {
  				var memoryAttachment = {
  	        "fallback": "Inspect memory",
  	        "color": "#FED33C",
  					"callback_id": 'memories', // Specify who the bot is going to speak on behalf of, and where.
  	        "title": memory.title,
  					"text": "",
  					"thumb_url": memory.image_url,
  					"actions": []
  	      }

  				// Seems these haven't been implemented in Chatbot.js yet
  				memory.buttons.forEach(button => {
  					memoryAttachment.actions.push({
  						"type": "button",
  						"name": button.payload,
  						"text": button.title,
  						"value": button.title
  					})
  				})

  				params.attachments.push(memoryAttachment)
  			})
  		} else if(thisResponse.message.attachment.type == "image") {
  			// Display an attachment
  			// NB: Slack bug (https://github.com/slackhq/slack-api-docs/issues/53) where image_url doesn't show at all :/
  			logger.trace("Displaying an image attachment")

  			params.attachments.push({
          "fallback": "An image that's attached for your memory.",
  				"thumb_url": thisResponse.message.attachment.payload.url,
  				"text": "Attached image: "+thisResponse.message.attachment.payload.url,
          // "footer": "Attached image"
  			})
  		}
  	}

  	if(thisResponse.message.quick_replies && thisResponse.message.quick_replies.length > 0) {
  		logger.trace("Adding buttons");

      console.log('thisResponse', thisResponse);
      console.log('thisResponse.message.cards', thisResponse.message.cards);

  	}


    if (thisResponse.message.cards && thisResponse.message.cards.length) {
      thisResponse.message.text = 'Here\'s what I found:'
      thisResponse.message.cards.forEach((card, i) => {
        const attachment = {
          fields: [],
        }
        if (card.fileTitle) {attachment.author_name = (card.type === 'file' ? '' : 'From: ') + card.fileTitle}
        if (card.fileUrl) attachment.author_link = card.fileUrl
        attachment.author_icon = getFileTypeImage(card.fileType)
        if (i === 0) {
          attachment.color = '#645AEF'
          attachment.title = card.description || card.title
          const fields = []
          if (card.created) fields.push({
            title: 'Created',
            value: new Date(card.created * 1000).toDateString(),
            short: true
          })
          if (card.modified) fields.push({
            title: 'Modified',
            value: new Date(card.modified * 1000).toDateString(),
            short: true
          })
          params.attachments.push(attachment)
          params.attachments.push({ fields: fields })
        } else if (i < 5 && thisResponse.message.moreResults) {
          attachment.text = card.description || card.title
          params.attachments.push(attachment)
        }
      })
      delete thisResponse.message.cards
      if (!thisResponse.message.moreResults) {
        params.attachments.push({
          footer: "More",
          fallback: "Oops, you can't ask for more",
          callback_id: 'results-options', // Specify who the bot is going to speak on behalf of, and where.
          color: "#645AEF",
          attachment_type: "default",
          actions: [
            {
              type: 'button',
              name: 'results',
              style: 'primary',
              text: 'Give me more results',
              value: 'more-results',
            }
          ]
        })
      }

  		params.attachments.push({
  			"footer": "Quick actions",
  			"fallback": "Oops, you can't quick-reply",
  			"callback_id": 'reaction-buttons', // Specify who the bot is going to speak on behalf of, and where.
        "color": "#FED33C",
        "attachment_type": "default",
  			"actions": []
      })

  		thisResponse.message.quick_replies.forEach(reply => {
  			params.attachments[params.attachments.length-1].actions.push({
  				"type": "button",
  				"name": reply.payload,
  				"text": reply.title,
  				"value": reply.title
  			})
  		})
    }
  } catch(e) {
    logger.error(e)
  }

	// if (!thisResponse.sender_action) sendSenderAction(thisResponse.recipient.id, 'typing_on');
	setTimeout(function() {
		// if(params.attachments) console.log("Buttons should attach", params.attachments[0].actions)
		const messageData = {
      teamID: thisResponse.recipient.platformSpecific.team,
			recipient: thisResponse.recipient.platformSpecific.channel,
			text: thisResponse.message.text,
      params: params
			// params: params
		}
    console.log(JSON.stringify(messageData))
		logger.trace('messageData', messageData)
		sendClientMessage({
			action: 'sendMessage',
			data: messageData
		}).then(x => {
      console.log(messageData);
			d.resolve(messageData)
		}).catch(err => d.reject("ERROR Emitted response",err))
	}, delay);
	return d.promise;
}

/**
 * Takes message id-related data and returns message data (docs: https://api.slack.com/methods/channels.history)
 *
 * @param  {Object} messageSpecs
 * @param  {String} messageSpecs.team
 * @param  {String} messageSpecs.channel
 * @param  {String} messageSpecs.ts
 * @return {Object}
 */
const getMessageBySpecs = messageSpecs => new Promise(function(resolve, reject) {
	logger.trace(messageSpecs)
	sendClientMessage({
		action: 'getMessageData',
		data: messageSpecs
	}).then(messageData => {
		logger.trace('messageData', messageData)
		resolve(messageData)
	})
})

// For webhooks
exports.interactive = function(action) {

	logger.trace("User interacted with something interactive!", action)

  switch (action.callback_id) {
    case 'reaction-buttons':
      return reactionButtonPressed(action)
    case 'results-options':
      return resultsOptionsPressed(action)
  }
}

exports.dropdown = function() {
	//
}


const reactionButtonPressed = action => new Promise((resolve, reject) => {
  // Define this specific message sender as part of the conversational chain
  // Even if the bot itself is speaking on behalf of the user
  // var alias = `On behalf of ${action.channel.id.charAt(0) === 'D' ? action.user.name : "#"+action.channel.name}`
  var alias = `${action.user.name} via ForgetMeNot` // Maybe say when you're reacting for the group?
  // console.log("Bot posting as", alias, aliasDirectory[alias])

  // 1. Remove the UI buttons
  var noBtnMessage = action.original_message
  logger.trace(action.original_message);
  noBtnMessage.attachments.forEach((attachment, i) => {
    if (attachment.callback_id === 'reaction-buttons')
    noBtnMessage.attachments[i] = { footer: 'Thanks for your feedback!' }
  })
  noBtnMessage.params = {
    attachments: noBtnMessage.attachments
  }
  noBtnMessage.ts = action.message_ts
  noBtnMessage.recipient = action.channel.id
  noBtnMessage.teamID = action.team.id
  logger.trace(noBtnMessage)
  // res.json(noBtnMessage)

  sendClientMessage({
    action: 'updateMessage',
    data: noBtnMessage
  }).then(res => {
    logger.trace('Reaction sent!', res);
  }).catch(e => {
    logger.error(e)
  })


  // // 2. Post reply to slack on behalf of user
  // const messageData = {
  // 	recipient: action.callback_id,
  // 	text: action.actions[0].value,
  // 	params: {
  // 		as_user: false,
  // 		username: alias
  // 	}
  // }
  // sendClientMessage({
  // 	action: 'sendMessage',
  // 	data: messageData
  // }).then(() => {
  // 	// 3. Post the payload to the API on behalf of user
  // 	handleMessage({
  // 			channel: action.callback_id, // converts to sender at handleMessage()
  // 			quick_reply: action.actions[0].name // the payload string
  // 		}
  // 		// emitter({recipient: action.callback_id})
  // 		// I get the feeling the Chatbot specifies the recipient.id anyway.
  // 	)
  // }).catch((e)=>logger.error(e))

})

const resultsOptionsPressed = action => {
  if (action.actions[0].value === 'more-results') {
    return packageAndHandleMessage({
      quick_reply: 'REQUEST_MORE_RESULTS',
      sender: {
        team: action.team.id,
        channel: action.channel.id,
        user: action.user.id,
      }
    })
  }
}

const getFileTypeImage = fileType => {
  switch (fileType) {
    case 'application/vnd.google-apps.document':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'https://lh4.ggpht.com/-wROmWQVYTcjs3G6H0lYkBK2nPGYsY75Ik2IXTmOO2Oo0SMgbDtnF0eqz-BRR1hRQg=w300'
    case 'application/vnd.google-apps.spreadsheet':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'http://icons.iconarchive.com/icons/dtafalonso/android-lollipop/512/Sheets-icon.png'
    case 'application/vnd.google-apps.presentation':
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'http://cliparting.com/wp-content/uploads/2017/07/Google-slides-icon-free-download-at-icons8-clipart.png'
    case 'application/pdf':
      return 'https://cdn1.iconfinder.com/data/icons/adobe-acrobat-pdf/154/adobe-acrobat-pdf-file-512.png'
    case 'image/png':
    case 'image/jpg':
    case 'image/jpeg':
    case 'image/gif':
      return 'https://cdn3.iconfinder.com/data/icons/faticons/32/picture-01-512.png'
    default:
      return 'https://lh4.ggpht.com/-wROmWQVYTcjs3G6H0lYkBK2nPGYsY75Ik2IXTmOO2Oo0SMgbDtnF0eqz-BRR1hRQg=w300'
      // return 'https://cdn4.iconfinder.com/data/icons/48-bubbles/48/12.File-512.png'
  }
}
