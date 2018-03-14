//TODO: Remove temporary bits on lines 367, 497, 516
//TODO: check that scheduled reminders include attachments
//TODO: intent 'nextResult'
//TODO: timezones
//TODO: reminders when clocks differ between devices
//TODO: remove scheduled reminders when the memory is deleted
//TODO: handle API.ai error
//TODO: delete Cloudinary images when deleting memories
//TODO: account for API.ai grabbing both trigger-time and trigger-date
//TODO: return 400 etc errors when API receives invalid request (currently just breaks and eventually times out)



const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'})
// tracer.setLevel('warn');
const sinon = require('sinon')
const Q = require("q")
const emoji = require('moji-translate')
const schedule = require('node-schedule')
const chrono = require('chrono-node')
const Sherlock = require('sherlockjs')
const crypto = require("crypto")
const axios = require("axios")

const properties = require('../config/properties')
const track = require('../controller/track')
const users = require('../controller/users')
const nlp = require('../controller/nlp')
const Algolia = require('../controller/db_algolia')
const Firebase = require('../controller/db_firebase')
const uploader = require('../controller/uploader')
const sifter = require('../controller/sifter')

// Algolia setup
const AlgoliaParams = {
  appID: process.env.ALGOLIA_APP,
  adminApiKey: process.env.ALGOLIA_ADMIN_API_KEY,
  indexes: {
    users: process.env.ALGOLIA_USERS_INDEX
  }
}

if (process.env.NODE_ENV === "test") {
  const sandbox = sinon.sandbox.create()
  sandbox.stub(track, 'event').returns()
  sandbox.stub(users, 'authenticateSender').resolves()
  sandbox.stub(users, 'checkPermissions').resolves()
  sandbox.stub(users, 'fetchUserData').resolves({
    readAccess: null,
    uploadTo: null
  })

  // sandbox.stub(Algolia, 'connect').callsFake((appID, apiKey, indexID) => {
  //   return {
  //     getObject: () => {},
  //     searchObjects: () => new Promise((resolve, reject) => {
  //       // resolve({
  //       //   hits: [{
  //       //     description: 'The Company Address is 123 Fake Street'
  //       //   }]
  //       // })
  //       resolve({
  //         hits: [
  //           {
  //             description: 'How often does Savvy index files?\n\n- Every 60 seconds'
  //           },
  //           {
  //             description: 'Indexing Rules',
  //             type: 'file'
  //           },
  //           {
  //             description: 'Savvy indexes files on a regular basis - see Indexing Rules for more info'
  //           },
  //         ]
  //       })
  //     }),
  //     getFirstFromSearch: () => new Promise((resolve, reject) => {
  //       resolve({
  //         description: 'The Company Address is 123 Fake Street'
  //       })
  //     }),
  //     saveObject: (user, object) => new Promise((resolve, reject) => {
  //       if (!object.objectID) object.objectID = 12345
  //       resolve(object)
  //     }),
  //     deleteObject: () => new Promise((resolve, reject) => { resolve() })
  //   }
  // })
}


//
// const data = {
//   uid: 'GCyraAQwx2XsYeKYuYb01dU0SrF3',
//   organisationID: 'explaain',
//   objectID: 'abcde',
//   content: {
//     description: 'Here\'s an updated card...!'
//   },
//   userID: '5Jp1wfbyPXdb3IuYUuFl',
//   teamID: 'gqLdFXQ4Z9SAHfjd6IXX'
// }
// AlgoliaClient.initIndex('Savvy').addObject(data, function(err, content) {
//   if (err) {
//     const e = { code: 500, message: '📛 🔁  Failed to sync with Algolia! (Update)' }
//     console.log('📛 Error!', e.status, ':', e.message)
//   } else {
//     console.log('🔁  Synced with Algolia (Update)')
//   }
// })



const rescheduleAllReminders = function() {
	logger.trace(rescheduleAllReminders)
	const searchParams = {
		query: '',
		filters: 'intent: setTask.dateTime AND triggerDateTimeNumeric > ' + ((new Date()).getTime())
	};
  // Commented out for now as would need to search all indices!

	// searchForCards(apiKey, AlgoliaIndex, searchParams)
	// .then(function(content) {
	// 	const reminders = content.hits
  //   logger.trace('--- Reminders Rescheduled: ---\n\n')
	// 	reminders.forEach(function(r) {
	// 		scheduleReminder(r);
  //     logger.trace(r.actionSentence, ' (' + r.triggerDateTime + ')')
	// 	})
	// }).catch(function(e) {
	// 	logger.error(e);
	// });
}

var clientMessageFunction;
exports.acceptClientMessageFunction = function(messageFunction) {
	clientMessageFunction = messageFunction
}

// For sending standalone messages
const sendClientMessage = function(data) {
	const d = Q.defer()
	if (clientMessageFunction) {
		clientMessageFunction(data)
		.then(function(res) {
			d.resolve(res)
		}).catch(function(e) {
			logger.error(e)
			d.reject(e)
		})
	} else {
		const e = 'No clientMessageFunction defined'
		logger.error(e)
		d.reject(e)
	}
	return d.promise
}

// @TODO: Remove this and use exports.acceptRequest()
exports.deleteMemories = (sender, apiKey, organisationID, objectID) => new Promise(function(resolve, reject) {
  logger.trace('deleteMemories', sender, apiKey, organisationID, objectID)
  Algolia.connect(sender, apiKey, organisationID + '__Cards').deleteObject(objectID)
  .then(function(result) {
    track.event('Card Deleted', {
      organisationID: organisationID,
      userID: sender,
      objectID: objectID
    })
    resolve(result)
  }).catch(function(e) {
    logger.error(e)
    reject(e)
  })
})
/**
 * Takes sender data and returns User object from database
 *
 * @param  {Object} req
 * @param  {Object} req.sender
 * @param  {String} req.text
 * @param  {String} req.platform (Optional)
 * @return {Object}
 */
exports.acceptRequest = async function(req) {
  logger.debug('acceptRequest', req)
  try {
    // req.verified allows platforms/slack.js to verify with a Slack-specific method - if we need to do Firebase-related stuff maybe we should check here too! But for that we'll need some sort of Firebase auth token (normally found only in browser?)...
    var user = await users.getUserFromSender(req.sender, req.platform)
    logger.trace(user)
    if (!user && req.platform === 'slack') {
      user = await users.createUserFromSlack(req.sender)
    }
    if (user) req.sender = user
    if (req.platform !== 'slack') {
      await users.authenticateSender(req.sender)
      // @TODO: Add this back in somehow! (It currently uses Firebase Functions, which check user is in the organisation in the Firebase Sifrestore database - this means it won't currently work, because the user data is mainly in Algolia!)
      // await users.checkPermissions(req.organisationID, req.sender)
    }
    var card = {}
    console.log('card 1', card)
    if (!req.intent) { // @TODO: Check making this conditional doesn't break anything!
      const nlpData = await nlp.process(req.sender, req.text, req.contexts)
      if (nlpData['intent'] === 'store') card = req
      req = combineObjects(req, nlpData)
    }
    var result
    switch (req.intent) {
      case 'verify':
        result = await verifyCard(req)
        break
      case 'delete':
        result = await deleteCard(req)
        break
      default:
        console.log('card 2', card)
        result = await routeByIntent(req, card)
    }
    console.log('result')
    console.log(result)
    if (!result.statusCode) result.statusCode = 200 //temp
    logger.trace('Returning from API:', result)
    return result
  } catch (e) {
    console.error(e)
    return new Error(e)
  }
}

exports.getUserData = function(req) {
  logger.trace('getUserData');
	const d = Q.defer()
  logger.info(req)
  users.authenticateSender(req.sender)
  .then(res => { return users.checkPermissions(req.organisationID, req.sender) })
  .then(res => { return users.getUserData(req.organisationID, req.sender) })
	.then(function(result) {
    logger.trace()
    if (!result.statusCode) result.statusCode = 200 //temp
		d.resolve(result)
	}).catch(function(e) {
		logger.error(e);
		d.reject(e)
	});
	return d.promise
}


exports.getUserTeamDetails = function(req) {
  try {
    logger.trace('getUserTeamDetails');
    const d = Q.defer()
    logger.info(req)
    users.authenticateSender(req.sender)
    // .then(res => { return users.checkPermissions(req.organisationID, req.sender) })
    .then(res => { return users.getUserTeamDetails(req.organisationID, req.sender) })
    .then(function(result) {
      logger.trace()
      if (!result.statusCode) result.statusCode = 200 //temp
      d.resolve(result)
    }).catch(function(e) {
      logger.error(e);
      d.reject(e)
    });
    return d.promise
  } catch (e) {
    console.log(e)
  }
}

exports.addUserToOrganisation = (req) => new Promise(function(resolve, reject) {
  logger.trace('addUserToOrganisation')
  logger.info(req)
  users.authenticateSender(req.user)
  // .then(res => { return users.checkPermissions(req.organisationID, req.user) })
  .then(res => users.addUserToOrganisation(req.organisationID, req.user, req.verifiedEmails))
  .then(result => {
    logger.trace()
    if (!result.statusCode) result.statusCode = 200 //temp
    resolve(result)
  }).catch(function(e) {
    logger.error(e)
    reject(e)
  })
})

exports.fetchMixpanelData = function(data) {
  const start = data.start,
        end = data.end,
        event = data.event,
        properties = data.properties,
        limit = data.limit,
        organisationID = data.organisationID
  const queryUrl = 'https://4911948a523883a90eba70f3a70d578b@mixpanel.com/api/2.0/segmentation?from_date='+start+'&to_date='+end+'&event='+event + '&where=(properties["organisationID"] == "' + organisationID + '")' + (properties && properties.length ? '&on=properties["'+properties.join('","')+'"]' : '') + (limit ? '&limit=' + limit : '')
  logger.trace(queryUrl)
  return new Promise((resolve, reject) => {
    axios.get(queryUrl)
    .then(function(response) {
      // logger.trace(response.data);
      logger.trace(response.data.data)
      resolve(response.data.data)
    })
    .catch(function(error) {
      console.log(error);
      reject(error)
    })
  })
}


const routeByIntent = function(requestData, card) {
	logger.trace(routeByIntent, requestData)
  console.log('card 3', card)
	const d = Q.defer()
  var memory = {}
  if (requestData.intent == 'setTask') requestData.intent = 'setTask.dateTime' //temporary
  if (['setTask', 'setTask.dateTime', 'setTask.URL', 'provideURL', 'provideDateTime'].indexOf(requestData.intent) > -1) requestData.intent = 'store' // temporary!!
  requestData.generalIntent = getGeneralIntent(requestData.intent)
  if (requestData.generalIntent == 'write') {
    memory = getWrittenMemory(requestData)
    // logger.info(memory)
  }
  if (requestData.lastAction) var lastActionMemory = getWrittenMemory(requestData.lastAction.requestData);
  // if (requestData.intent == 'provideURL') requestData.intent = 'setTask.URL'
  // if (requestData.intent == 'provideDateTime') requestData.intent = 'setTask.dateTime'
  const data = {requestData: requestData, memories: [memory]}
	try {
	} catch(e) {
		//This should start figuring out the intent instead of giving up!
		logger.error(e);
		d.reject(e)
	}

	switch(requestData.intent) {
		case "nextResult":
			tryAnotherMemory(requestData.sender);
			break;

		case "store":
      // logger.info(memory)
      console.log('card 4', card)
			saveMemory(memory, requestData, card)
			.then(function(card) {
				d.resolve({ card: card })
			}).catch(function(e) {
				logger.error(e);
				d.reject(e)
			})
			break;

		case "query":
			try {
				recallMemory(requestData)
				.then(function(memories) {
					logger.trace(memories)
          if (memories.length == 0)
            logger.trace(404, 'No results found')
          data.memories = memories;
					d.resolve(data)
				}).catch(function(e) {
          logger.error(e);
          d.reject(e)
				})
			} catch (e) {
				logger.error(e);
				d.reject(e)
			}
			break;

		case "provideURL":
		case "setTask.URL":
			try {
        memory = lastActionMemory || memory
        memory.intent = 'setTask.URL'
        const urlMemory = getWrittenMemory(requestData)
				memory.reminderRecipient = requestData.sender;
				if (!memory.triggerURL) memory.triggerURL = urlMemory.entities['trigger-website'] || urlMemory.entities['trigger-url'];
        if (!memory.triggerURL && requestData.intent == 'provideURL') {
          memory.triggerURL = urlMemory.entities['website'] || urlMemory.entities['url']
        }
				if (memory.triggerURL) {
					if (Array.isArray(memory.triggerURL)) memory.triggerURL = memory.triggerURL[0]
					memory.actionSentence = getActionSentence2(memory.description || memory.content.description, memory.context)
          logger.info(memory.actionSentence)
          data.memories = [memory]
					saveMemory(memory, requestData)
					.then(function() {
						d.resolve(data)
					}).catch(function(e) {
						logger.error(e);
						d.reject(e)
					})
				} else {
					logger.trace(412, 'No URL specified');
          data.statusCode = 412
					d.resolve(data)
				}
			} catch(e) {
				logger.error(e);
				d.reject(e)
			}
			break;

		case "provideDateTime":
		case "setTask.dateTime":
			try {
        memory = lastActionMemory || memory
        memory.intent = 'setTask.dateTime'
        const dateTimeMemory = getWrittenMemory(requestData)
        // if (requestData.lastAction) {
        //   memory = requestData.lastAction.memories[0]
        // }
        var dateTimeOriginal = dateTimeMemory.entities['trigger-time'] || dateTimeMemory.entities['trigger-date'] || dateTimeMemory.entities['trigger-date-time'] || dateTimeMemory.entities['action-time'] || dateTimeMemory.entities['action-date'] || dateTimeMemory.entities['action-date-time']
        if (!dateTimeOriginal && requestData.intent == 'provideDateTime') {
          dateTimeOriginal = dateTimeMemory.entities['time'] || dateTimeMemory.entities['date'] || dateTimeMemory.entities['date-time'];
        }
				memory.reminderRecipient = requestData.sender;
				if (dateTimeOriginal) {
          // memory.actionSentence = getActionSentence(memory.sentence, memory.context)
          const actionText = rewriteSentence(memory.description || memory.content.description, true)
          memory.actionSentence = getEmojis(actionText) + ' ' + actionText;
          memory.triggerDateTimeNumeric = getDateTimeNum(dateTimeOriginal, dateTimeMemory)
    			memory.triggerDateTime = new Date(memory.triggerDateTimeNumeric);
          data.memories = [memory]
					saveMemory(memory, requestData)
					.then(function() {
						scheduleReminder(memory);
						d.resolve(data)
					}).catch(function(e) {
						logger.error(e);
						d.reject(e)
					})
				} else {
					logger.trace(412, 'No date/time specified');
          data.statusCode = 412
					d.resolve(data)
				}
			} catch(e) {
				logger.error(e);
				d.reject(e)
			}
			break;

		// case "provideDateTime":
		// 	var dateTimeOriginal = memory.entities.time || memory.entities.date || memory.entities['date-time'];
		// 	memory.triggerDateTimeNumeric = getDateTimeNum(dateTimeOriginal, memory)
		// 	memory.triggerDateTime = new Date(memory.triggerDateTimeNumeric);
		// 	try {
		// 		// memory.intent = getContext(sender, 'lastAction').intent;
		// 		// memory.context = getContext(sender, 'lastAction').context;
		// 		// memory.entities = getContext(sender, 'lastAction').entities;
		// 		// memory.sentence = getContext(sender, 'lastAction').sentence;
		// 		memory.actionSentence = getActionSentence(memory.sentence, memory.context)
		// 		schedule.scheduleJob(memory.triggerDateTime, function(){
		// 			sendTextMessage(sender, '🔔 Reminder! ' + memory.actionSentence)
		// 			logger.log('Reminder!', memory.actionSentence);
		// 		});
		// 		d.resolve(data)
		// 	} catch(e) {
		// 		logger.error(e);
		// 		d.reject(e)
		// 	}
		// 	break;

		// case "provideURL":
		// 	try {
		// 		memory.triggerURL = memory.entities['url'] || memory.entities['website'];
		// 		memory.triggerURL = memory.triggerURL[0]
		// 		// memory.intent = getContext(sender, 'lastAction').intent;
		// 		// memory.context = getContext(sender, 'lastAction').context;
		// 		// memory.entities = getContext(sender, 'lastAction').entities;
		// 		// memory.sentence = getContext(sender, 'lastAction').sentence;
		// 		memory.actionSentence = getActionSentence(memory.sentence, memory.context)
		// 	} catch(e) {
		// 		logger.error(e);
		// 		d.reject(e)
		// 	}
		// 	saveMemory(memory)
		// 	.then(function() {
		// 		d.resolve(data)
		// 	}).catch(function(e) {
		// 		logger.error(e);
		// 		d.reject(e)
		// 	})
		// 	break;

		default:
			if (requestData.intent && requestData.intent != 'Default Fallback Intent') {
				// sendGenericMessage(sender, memory.intent, getContext(sender, 'consecutiveFails') );
        d.resolve({requestData: requestData})
			} else {
				recallMemory(requestData)
				.then(function(memories) {
					logger.trace(memories)
					data.memories = memories;
					d.resolve(data)
				}).catch(function(e) {
					logger.error(e);
					d.reject(e)
				})
			}
			break;
	}
	return d.promise
}

const recallMemory = function(requestData) {
	logger.trace(recallMemory, requestData)
	const d = Q.defer()
	var searchTerm = requestData.query.toLowerCase().replace(/[^\w\s.]|_/g, " ");// memory.context.map(function(e){return e.value}).join(' ');
  logger.trace(requestData.parameters.extraContext)
  if (typeof requestData.parameters.extraContext !== 'object' && typeof requestData.parameters.extraContext !== 'array') requestData.parameters.extraContext = [requestData.parameters.extraContext]
  logger.trace(requestData.parameters.extraContext)
  requestData.parameters.extraContext.forEach(phrase => {
    searchTerm = searchTerm.replace(phrase, '')
  })
  searchTerm = searchTerm.substring(0, 500).trim() // Only sends Algolia the first 511 characters as it can't hanlogger.tracee more than that
  logger.trace(searchTerm)
	users.fetchUserData(requestData.sender.uid)
	.then(function(userData) {
		const readAccessList = userData.readAccess || []
    /* Temporarily allowing everything to search ACME userID */ readAccessList[readAccessList.length] = '101118387301286232222'
		const userIdFilterString = 'userID: ' + requestData.sender.uid + readAccessList.map(function(id) {return ' OR userID: '+id}).join('');
		const searchParams = {
			query: searchTerm,
			// filters: userIdFilterString,
      hitsPerPage: 10,
			// filters: (attachments ? 'hasAttachments: true' : '')
		};
    if (!requestData.filters) requestData.filters = {}
    if (!requestData.filters.type) requestData.filters.type = requestData.parameters.preferredCardType

    if (requestData.filters.type && requestData.filters.type.length && requestData.filters.type !== 'all')
      searchParams.filters = 'type: "' + requestData.filters.type + '"'
    logger.trace(searchParams)
    metadata = {
      dialogFlowSuccess: requestData.dialogFlowSuccess
    }
    return searchForCards(requestData.sender, searchParams, metadata)
	}).then(function(content) {
		if (!content.hits.length) {
      logger.trace('No results found')
    }
    logger.trace('hits!', content.hits)
    d.resolve(content.hits)
    //  else {
			// d.reject(404);
			// tryCarousel(sender, memory.sentence)
			// .then(function() {
			// 	return Q.fcall(function() {return null});
			// }).catch(function(e) {
			// 	memory.failed = true;
			// 	return sendTextMessage(sender, "Sorry, I can't remember anything" + ((hitNum && hitNum > 0) ? " else" : "") + " similar to that!")
			// })
		// }
	// }).then(function() {
	// 	return getContext(sender, 'onboarding') ? sendTextMessage(sender, "Actually you now have two powers! With me, you also get the power of Unlimited Memory 😎😇🔮", 1500, true) : Q.fcall(function() {return null});
	// }).then(function() {
	// 	return getContext(sender, 'onboarding') ? sendTextMessage(sender, "Now feel free to remember anything below - text, images, video links you name it...", 1500, true) : Q.fcall(function() {return null});
	// }).then(function() {
	// 	setContext(sender, 'onboarding', false)
	// 	d.resolve()
	}).catch(function(err) {
		logger.error(err);
		d.reject(err)
	});
	return d.promise
}

const saveMemory = function(m, requestData, tempCard) {
  console.log('card 5', tempCard)
	logger.trace()
	const d = Q.defer()
	m.hasAttachments = !!(m.attachments) /* @TODO: investigate whether brackets are needed */
  // logger.info(m)
  var author
  const uid = requestData.sender.uid
  const memoryExists = !!m.objectID
  users.fetchUserData(uid)
  .then(function(res) {
    author = res
  //   return memoryExists ? getDbObject(AlgoliaIndex, m.objectID) : Q.fcall(function() {return null})
  // }).then(function(existingCard) {
		m.userID = author ? author.uploadTo || uid : uid;
  //   // if (author.teams) {
  //   //   if (!memoryExists) {
  //   //     m.teams = author.teams.map(function(team) {
  //   //       return team.teamID
  //   //     })
  //   //   } else {
  //   //     if (author.teams.filter(function(team) { return team.role == 'manager'}).length == 0 ) {
  //   //       m.pending = [m.content]
  //   //       m.content = existingCard ? existingCard.content : {}
  //   //     }
  //   //   }
  //   // }
  //   m.expiryDate = new Date().setMonth(new Date().getMonth() + 3)

	// 	const searchParams = {
	// 		query: m.content.description.substring(0, 500), // Only sends Algolia the first 511 characters as it can't hanlogger.tracee more than that
	// 		filters: 'userID: ' + m.userID,
	// 		getRankingInfo: true
	// 	};
	// 	return searchDb(AlgoliaIndex, searchParams)
	// // }).then(function() {
	// // 	return m.hasAttachments ? sendAttachmentUpload(sender, m.attachments[0].type, m.attachments[0].url) : Q.fcall(function() {return null});
  // }).then(function(results) {
	// 	if (m.hasAttachments && results[0] && results[0].value.attachment_id) m.attachments[0].attachment_id = results[0].value.attachment_id;
		return m.hasAttachments && m.attachments[0].type=="image" ? backupAttachment(uid, m.attachments[0].type, m.attachments[0].url) : Q.fcall(function() {return null});
	}).then(function(url) {
		if (m.hasAttachments && url) m.attachments[0].url = url;
		// if (memoryExists) {
    //   // logger.info(m)
		// 	return updateDb(requestData.sender, m, requestData)
		// } else {
    console.log('card 6', tempCard)
    const card = JSON.parse(JSON.stringify(tempCard))
    if (!card.description && requestData.text) card.description = requestData.text
    if (card.description) {
      card.description = card.description.replace(/^remember that /i, '').replace(/^remember /i, '')
      card.description = card.description.charAt(0).toUpperCase() + card.description.slice(1)
    }
    if (card.sender) delete card.sender
    if (card.intent) delete card.intent
    if (card.generalIntent) delete card.generalIntent
    if (card.modified) delete card.modified
    if (card.allInOne) delete card.allInOne
    if (requestData.service && requestData.service) {
      card.type = 'file' // @TODO: We're assuming this! Fix!
    }
    // @TODO: Maybe have user choose a source so we can send card.source?
    const author = {
      objectID: requestData.sender.objectID,
      name: requestData.sender.first + ' ' + requestData.sender.last,
      organisationID: requestData.sender.organisationID,
      role: requestData.sender.role,
      topics: requestData.sender.topics,
    }
    console.log('card!!!!!!')
    console.log(card)
    return axios.post('https://savvy-nlp--staging.herokuapp.com/save-card', { card: card, author: author })
    // return axios.post('http://localhost:5050/save-card', { card: card, author: author })
	}).then(function(res) {
    const card = res.data.card
    console.log('Returned Card')
    console.log(card)
		d.resolve(card)
	}).catch(function(e) {
		logger.error(e);
		d.reject(e)
	});
	return d.promise;
}


const searchForCards = async function(user, params, metadata) {
  logger.trace(searchForCards, user, params)
  try {
    const index = user.organisationID + '__Cards'
    logger.debug('📡  Sending to Algolia:', params)
    const content = await Algolia.connect(AlgoliaParams.appID, user.algoliaApiKey, index).searchObjects(params)
    // const itemCards = await fetchListItemCards(apiKey, index, content.hits) // What do we do with itemCards here?!
    logger.debug('🔦  Received from Algolia:', content.hits.map(hit => { return { title: hit.title || null, content: (hit.content || hit.description || hit.title || hit.fileTitle).substring(0, 50)+'...', fileTitle: hit.fileTitle || null } }))
    logger.trace('Search Results:', content)
    track.event('Searched', {
      distinct_id: user.uid,
      organisationID: user.organisationID,
      userID: user.uid,
      searchQuery: params.query,
      results: content.hits,
      noOfResults: content.hits.length,
      searchParams: params,
      cardID: content.hits.length === 1 ? content.hits[0].objectID : null,
      cardContent: content.hits.length === 1 ? content.hits[0].description || content.hits[0].content || content.hits[0].title : null,
      cardTitle: content.hits.length === 1 ? content.hits[0].title || content.hits[0].fileTitle : null,
      fileTitle: content.hits.length === 1 ? content.hits[0].fileTitle : null,
      fileUrl: content.hits.length === 1 ? content.hits[0].fileUrl : null,
      fileID: content.hits.length === 1 ? content.hits[0].fileID : null,
      fileType: content.hits.length === 1 ? content.hits[0].fileType : null,
      cardType: content.hits.length === 1 ? content.hits[0].type : null,
      cardModified: content.hits.length === 1 ? content.hits[0].modified : null,
      cardCreated: content.hits.length === 1 ? content.hits[0].created : null,
      dialogFlowSuccess: metadata.dialogFlowSuccess,
    })
    return content
  } catch (e) {
    logger.error(e)
    return e
  }
}


const saveToDb = async function(user, card, requestData) {
  /* Temporarily replacing all Slack userIDs with ACME userID */ if(card.userID.length < 10) card.userID = '101118387301286232222'
  logger.trace(saveToDb, user, card, requestData)
	card.dateCreated = Date.now()

  const data = {
    objectID: card.objectID || null,
    title: card.title,
    description: card.description,
    creatorID: user.uid,
    created: parseInt(new Date().getTime()/1000),
    modified: parseInt(new Date().getTime()/1000),
    service: typeof requestData.service == 'string' ? requestData.service : null
  }
  if (card.title) data.title = card.title
  logger.trace('💎  Here\'s the data:', data)
  response = await Algolia.connect(AlgoliaParams.appID, user.algoliaApiKey, user.organisationID + '__Cards').saveObject(user, data)
  logger.trace('📪  The response!', response)
  if (!data.objectID) data.objectID = response.objectID
  track.event('Card Saved', {
    distinct_id: data.creatorID,
    organisationID: data.organisationID,
    userID: data.creatorID,
    card: data,
    cardID: data.objectID,
    cardContent: card.description,
    cardTitle: card.title,
    cardType: 'manual',
    cardModified: data.modified,
    cardCreated: data.created,
    dialogFlowSuccess: requestData.dialogFlowSuccess
  })
	logger.trace('User card updated successfully!')
  if (data.service === 'sifter')
    sifter.save(data)
	return
}
// const updateDb = function(user, memory, requestData) {
//   logger.trace(updateDb, user, memory, requestData)
//   /* Temporarily replacing all Slack userIDs with ACME userID */ if(memory.userID.length < 10) memory.userID = '101118387301286232222'
// 	const d = Q.defer();
// 	memory.dateUpdated = Date.now()
//
//   const data = {
//     organisationID: user.organisationID,
//     objectID: memory.objectID || null,
//     content: memory.content,
//     userID: user.uid
//   }
//   logger.trace('💎  Here\'s the data:', data)
//   Algolia.connect(AlgoliaParams.appID, user.algoliaApiKey, user.organisationID + '__Cards').saveObject(user, data)
//   .then(function(response) {
//     logger.trace('📪  The response!', response);
//     track.event('Card Updated', {
//       organisationID: data.organisationID,
//       userID: data.userID,
//       card: data
//     })
//     logger.trace('User memory updated successfully!')
//     d.resolve()
//   }).catch(function(e) {
//     console.log('📛  Error!', e);
//     d.reject()
//   })
// 	return d.promise;
// }

exports.fetchUserDataFromDb = users.fetchUserDataFromDb;



const verifyCard = async req => {
  const res = await axios.post('https://savvy-nlp--staging.herokuapp.com/verify-card', { objectID: req.objectID, author: req.sender, prop: req.prop, approve: req.approve })
  // const res = await axios.post('http://localhost:5050/verify-card', { objectID: req.objectID, author: req.sender, prop: req.prop, approve: req.approve })
  const result = res.data
  return result
}

const deleteCard = async req => {
  const res = await axios.post('https://savvy-nlp--staging.herokuapp.com/delete-card', { card: { objectID: req.objectID }, author: req.sender })
  // const res = await axios.post('http://localhost:5050/delete-card', { card: { objectID: req.objectID }, author: req.sender })
  const result = res.data
  return result
}


const getDateTimeNum = function(dateTimeOriginal, memory) {
	// logger.trace(getDateTimeNum)
	// dateTime = dateTimeOriginal[0]
	// dateTime = chrono.parseDate(dateTime) || dateTime;
	// var dateTimeNum = dateTime.getTime();
	// if (!memory.entities['trigger-time'] && !memory.entities['trigger-date'] && dateTimeOriginal.toString().length > 16)
  //   dateTimeNum = dateTimeNum - 3600000
	// if (dateTimeNum < new Date().getTime() && dateTimeNum+43200000 > new Date().getTime())
  //   dateTimeNum += 43200000;
	// else if (dateTimeNum < new Date().getTime() && dateTimeNum+86400000 > new Date().getTime())
  //   dateTimeNum += 86400000;

  // Trying out replacing all the above with Sherlock

  var sherlockTime = Sherlock.parse(memory.description || memory.content.description).startDate
  if (!sherlockTime.hasMeridian && sherlockTime.getHours() > 12) {
    sherlockAmTime = new Date(sherlockTime - 43200000)
    if (sherlockAmTime.getHours() > 7 && sherlockAmTime > new Date()) {
      logger.info('Resetting to AM')
      sherlockTime = sherlockAmTime
    }
  }

  var apiTime = new Date(dateTimeOriginal[0]).getTime() || new Date(dateTimeOriginal[0].split('/')[0]).getTime()
  if (!apiTime) {
    const d = dateTimeOriginal[0].split(':')
    apiTime = new Date().setHours(d[0], d[1], d[2])
  }
  apiTime = new Date(apiTime)
  // logger.info(apiTime)
  // logger.info(sherlockTime)
  // logger.info(apiTime.getTime())
  // logger.info(sherlockTime.getTime())
  var diff = sherlockTime - apiTime + 3600000
  var myTest = diff < 2000
  // if (myTest)
  //   logger.warn(myTest)
  // else
  //   logger.info(myTest)

  const dateTimeNum = sherlockTime.getTime()
	return dateTimeNum
}



const backupAttachment = uploader.upload


const scheduleReminder = function(memory) {
	logger.trace(scheduleReminder)
	schedule.scheduleJob(memory.triggerDateTime, function(){
    delete memory.resultSentence
    const data = {
      statusCode: 200,
      requestData: {
        sender: memory.reminderRecipient || memory.userID,
        intent: 'reminder.dateTime'
      },
      memories: [
        memory
      ]
    }
    sendClientMessage(data)
		logger.trace('Reminder!', memory.actionSentence);
	});
}



const fetchListItemCards = function(apiKey, index, cards) {
  const d = Q.defer()
  const self = this
  const promises = []
  cards.forEach(function(card) {
    if (card.listItems) {
      card.listCards = {}
      card.listItems.forEach(function(key) {
        const p = Q.defer()
        Algolia.connect(AlgoliaParams.appID, apiKey, index).getObject(key)
        .then(function(content) {
          card.listCards[key] = content;
          p.resolve(content);
        }).catch(function(e) {
          logger.error(e);
          p.reject(e)
        })
        promises.push(p.promise)
      })
    }
  })
  Q.allSettled(promises)
  .then(function(results) {
    logger.trace('List Item Cards:', results)
    d.resolve(results);
  }).catch(function(e) {
    logger.error(e);
    d.reject(e)
  })
  return d.promise
}


const getActionSentence2 = function(sentence, context, reminder) {
  logger.info(sentence)
  const splitSecond = [
    'need to',
    'emind you to',
    'emind you'
  ]
  const splitFirst = [
    'when you',
    'next time'
  ]
  var text = sentence
  splitSecond.forEach(function(phrase) {
    if (sentence.indexOf(phrase) > -1 && text == sentence)
      text = sentence.split(phrase)[1]
  })
  var text1 = text
  splitFirst.forEach(function(phrase) {
    if (text.indexOf(phrase) > -1 && text1 == text)
      text1 = text.split(phrase)[0]
  })
  text1 = rewriteSentence(text1, reminder)
  return getEmojis(text1) + ' ' + text1;
}


const getActionSentence = function(sentence, context, reminder) {
	// logger.trace(getActionSentence)
	// const actionContext = [];
	// context.forEach(function(c) {
	// 	if (c.type.indexOf('action-') > -1) {
	// 		actionContext.push(c.value);
	// 	}
	// })
	// const start = Math.min.apply(null, actionContext.map(function(a) {
	// 	return sentence.toLowerCase().indexOf(a.toLowerCase())
	// }).filter(function(b) {
	// 	return b > -1
	// }))
	// const end = Math.max.apply(null, actionContext.map(function(a) {
	// 	return sentence.toLowerCase().indexOf(a.toLowerCase()) + a.length
	// }).filter(function(b) {
	// 	return b > -1
	// }))
	// const text = rewriteSentence(sentence.substring(start, end+1))
	const text = rewriteSentence(sentence, reminder)
  return getEmojis(sentence) + ' ' + sentence;

  // Trying out replacing all the above with Sherlock
  // const text = rewriteSentence(Sherlock.parse(sentence).eventTitle)
  // const actionSentence = getEmojis(text) + ' ' + text;
	// return actionSentence
}

function rewriteSentence(originalSentence, reminder) { // Currently very primitive!
  logger.debug(originalSentence);
  if (!originalSentence)
    return null
  var sentence = JSON.parse(JSON.stringify(originalSentence))
	sentence = sentence.trim().replace(/’/g, '\'');
  // const remove1 = [
  //   /^Remember that /i,
  //   /^Remember /i,
	// 	/^Remind me to /i,
  //   /^Remind me /i,
	// 	/^I need to /i,
  //   /^I should /i,
  // ]
  if (reminder) {
    const remove1 = [
      ["remember that ", /remember that /i],
      ["remember to ", /remember to /i],
      ["remember ", /remember /i],
      ["remind you to ", /remind you to /i],
      ["remind you ", /remind you /i],
      ["you need to ", /you need to /i],
      ["you should ", /you should /i],
    ]
    const remove2 = [
      /^Please /i,
      / please\.^/i,
      / please^/i,
    ];
    remove1.forEach(function(r) {
      const pos = sentence.toLowerCase().indexOf(r[0])
      if (pos > -1) {
        if (pos > 4) {
          sentence = sentence.substring(pos+r[0].length, sentence.length)
        }
        else {
          sentence = sentence.replace(r[1], ' ')
          sentence = reminder ? (Sherlock.parse(sentence).eventTitle || sentence) : sentence
        }
      }
    });
    const origPos = originalSentence.indexOf(sentence)
    if (origPos > 15) {
      sentence = originalSentence.substring(origPos, originalSentence.length)
    }
    remove2.forEach(function(r) {
      sentence = sentence.replace(r, '');
    });
  }
  var sentenceE = encodeURIComponent(sentence)
  const replaceE = [
    ["I%5C'm", 'you\'re'],
    ["i%5C'm", 'you\'re'],
  ];
  replaceE.forEach(function(r) {
    sentenceE = sentenceE.replace(r[0], r[1]);
  });
  sentence = decodeURIComponent(sentenceE)

  const replace = [
    [/\bI\'m\b/i, 'you\'re'],
    [/\bIm\b/i, 'you\'re'],
    [/\bI am\b/i, 'you are'],
    [/\bme\b/i, 'you'],
    [/\bmy\b/i, 'your'],
    [/\bI\b/i, 'you'],
  ];
  replace.forEach(function(r) {
    sentence = sentence.replace(r[0], r[1]);
  });
  sentence = sentence.trim();
	sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1)
  if (~[".","!","?",";"].indexOf(sentence[sentence.length-1])) sentence = sentence.substring(0, sentence.length - 1);
  return sentence;
}

/* Now returns both context and all the other bits (except intent) */
function extractAllContext(e) {
	logger.trace();
	const entities = JSON.parse(JSON.stringify(e)); // Hopefully this avoids deleting/editing things in the original entities object outside this function!
		const finalEntities = {
		context: [],
		entities: {}
	};
		// if (entities.intent) delete entities.intent;
	const names = Object.keys(entities);
	names.forEach(function(name) {
		if (entities[name] && entities[name].length) {
			if (!Array.isArray(entities[name])) entities[name] = [entities[name]];
			finalEntities.entities[name] = entities[name];
			entities[name].forEach(function(value) {
				finalEntities.context.push({
					type: name,
					value: value
				})
			});
		}
	});
	return finalEntities;
}

const getWrittenMemory = function(requestData) {
  var memory = requestData.parameters ? extractAllContext(requestData.parameters) : {}
  // logger.info('❇️ ❇️ ❇️ ' + requestData.intent)
  memory.intent = requestData.intent;
  memory.author = requestData.sender.uid;
  // memory.content = requestData.content || {
  //   description: rewriteSentence(requestData.query),
  //   listItems: requestData.listItems,
  // }
  memory.description = rewriteSentence(requestData.query || requestData.description)
  if (requestData.title) memory.title = requestData.title
  if (requestData.listItems) memory.listItems = requestData.listItems
  memory.extractedFrom = requestData.extractedFrom
  memory.attachments = requestData.attachments;
  memory.triggerURL = requestData.triggerURL;
  if (requestData.objectID) memory.objectID = requestData.objectID;
  logger.trace(memory);
  return memory
}


const getEmojis = function(text, entities, max, strict) {
	if (strict) {
		const words = entities['noun'] || entities['action-noun'] || entities['verb'] || entities['action-verb']
		if (words) text = words.join(' ')
	}

	return (emoji.translate(text.replace(/[0-9]/g, ''), true).substring(0, 2) || '✅')
}


const combineObjects = function(a, b) {
  // a's properties have priority over b's
  Object.keys(a).forEach(function(key) {
    b[key] = a[key]
  })
  return b
}

const getGeneralIntent = function(intent) {
  // What about no intent?
  // 'provideDateTime', 'provideURL' shouldn't really be automatically 'write'
  if (['store', 'setTask', 'setTask.dateTime', 'setTask.URL', 'deleteMemory', 'provideDateTime', 'provideURL'].indexOf(intent) > -1) {
    return 'write'
  } else if (['query']) {
    return 'read'
  } else {
    return 'other'
  }
}

if (process.env.NODE_ENV !== "test") {
  // rescheduleAllReminders()
}
