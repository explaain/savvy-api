//TODO: find better logging system
//TODO: + easy way to get logs before any error
//TODO: add setTask test
//TODO: test that task actionSentences don't include "remind me to", numbers etc
//TODO: test that task actionSentences extract the key info
//TODO: add a reschedule test (for some event set years into the future)

// Uses environment variables from test.env inside this folder.
require('dotenv').config({path: 'test/test.env'})

const Q = require("q");
const assert = require('assert');
const sinon = require('sinon');

const api = require('../app/controller/api');
const chatbot = require('../app/controller/chatbot');
const slack = require('../app/platforms/slack');
const properties = require('../app/config/properties.js');
const Encrypt = require('../app/controller/db_encrypt.js');

const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'});

// Algolia setup
const AlgoliaSearch = require('algoliasearch');
const AlgoliaClient = AlgoliaSearch(properties.algolia_app_id, properties.algolia_api_key, { protocol: 'https:' });
const AlgoliaIndex = AlgoliaClient.initIndex(process.env.ALGOLIA_INDEX);


const sandbox = sinon.sandbox.create()
const track = {event: null}
const nlp = {process: null}
const uploader = {upload: null}
const users = {authenticateSender: null, checkPermissions: null, fetchUserData: null}
const Firebase = {save: null}
const Algolia = {connect: null}
sandbox.stub(track, 'event').returns()
sandbox.stub(nlp, 'process').callsFake((sender, query, contexts) => new Promise((resolve, reject) => {
  resolve({
    source: 'agent',
    query: query,
    contexts: [],
    score: 0.8600000143051147,
    intent: query == 'hi' ? 'greeting' : (query.indexOf('The ') === 0 ? 'store' : 'query')
  })
}))
sandbox.stub(uploader, 'upload').resolves('url_123')
sandbox.stub(users, 'authenticateSender').resolves()
sandbox.stub(users, 'checkPermissions').resolves()
sandbox.stub(users, 'fetchUserData').resolves({
  readAccess: null,
  uploadTo: null
})
sandbox.stub(Firebase, 'save').resolves({
  data: {
    objectID: ''
  }
})
sandbox.stub(Algolia, 'connect').callsFake((appID, apiKey, indexID) => {
  switch (indexID) {
    case 'organisations':
    case '-local-organisations':
      return {
        getObject: () => new Promise((resolve, reject) => {
          resolve({
            objectID: '12345',
            hello: 'U2FsdGVkX1/LHanxXxEyISHsMLrQANMxY6mkKDxyMGk=',
            goodbye: 'U2FsdGVkX19eQm4bVEn/+Zkr72nGntIzcghHomDImT4='
          })
        }),
        saveObject: (user, object) => new Promise((resolve, reject) => {
          if (!object.objectID) object.objectID = 12345
          resolve(object)
        }),
        deleteObject: () => new Promise((resolve, reject) => { resolve() })
      }
      break
    // default:
    //   return {
    //     getObject: () => {},
    //     searchObjects: () => new Promise((resolve, reject) => {
    //       resolve({
    //         hits: [
    //           {
    //             description: 'How often does Savvy index files?\n\n- Every 60 seconds1'
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
    //         description: 'How often does Savvy index files?\n\n- Every 60 seconds2'
    //       })
    //     }),
    //     saveObject: (user, object) => new Promise((resolve, reject) => {
    //       if (!object.objectID) object.objectID = 12345
    //       resolve(object)
    //     }),
    //     deleteObject: () => new Promise((resolve, reject) => { resolve() })
    //   }
  }
})



const temporaryMemories = []

const sendRequest = function(apiFunction, data, results, done) {
  const d = Q.defer()
  logger.log(results)
  apiFunction(data)
  .then(function(body) {
    // Stops accidental Circular Structure
    if (body && body.requestData && body.requestData.lastAction && body.requestData.lastAction.requestData && body.requestData.lastAction.requestData.lastAction) delete body.requestData.lastAction.requestData.lastAction
    body = JSON.parse(JSON.stringify(body))
    if (results) results.body = body
    if (done) {
      done()
    }
    if (body.requestData.generalIntent == 'write' && body.requestData.intent != 'deleteMemory') {
      temporaryMemories.push(body.memories[0])
    }
    d.resolve(body)
  }).catch(function(e) {
    if (e == 412) {
      logger.trace(e)
      done()
    } else {
      logger.error(e);
      if (done) done(e)
      d.reject(e)
    }
  })
  return d.promise
}

const sendApiRequest = function(sender, message, results, done) {
  const data = {
    sender: sender,
    organisationID: 'explaain',
    text: message,
  }
  const apiFunction = api.acceptRequest
  return sendRequest(apiFunction, data, results, done)
}


const sendApiDeleteRequest = function(sender, objectID, results, done) {
  api.deleteMemories(sender, objectID)
  .then(function(body) {
    results.body = body
    logger.log(results)
    if (done) done()
  }).catch(function(e) {
    logger.error(e);
    if (done) done(e)
  })
}


  const sendChatbotRequest = function(sender, message, results, done) {
    const data = {
      entry: [
        {
          messaging: [
            {
              sender: {
                id: sender
              },
              message: {
                text: message
              },
            }
          ]
        }
      ]
    }
    const apiFunction = chatbot.handleMessage
    return sendRequest(apiFunction, data, results, done)
  }


const sendChatbotQuickReply = function(sender, code, results, done) {
  const data = {
    entry: [
      {
        messaging: [
          {
            sender: {
              id: sender
            },
            message: {
              quick_reply: {
                payload: code
              }
            },
          }
        ]
      }
    ]
  }
  const apiFunction = chatbot.handleMessage
  return sendRequest(apiFunction, data, results, done)
}

const sendChatbotPostback = function(sender, code, results, done) {
  const data = {
    entry: [
      {
        messaging: [
          {
            sender: {
              id: sender
            },
            postback: {
              payload: code
            }
          }
        ]
      }
    ]
  }
  const apiFunction = chatbot.handleMessage
  return sendRequest(apiFunction, data, results, done)
}

const sendChatbotAttachments = function(sender, code, results, done) {
  const data = {
    entry: [
      {
        messaging: [
          {
            sender: {
              id: sender
            },
            message: {
              attachments: [
                {
                  type: 'image',
                  payload: {
                    url: 'https://unsplash.it/200/300/?random'
                  }
                }
              ]
            },
          }
        ]
      }
    ]
  }
  const apiFunction = chatbot.handleMessage
  return sendRequest(apiFunction, data, results, done)
}

const checkMemoryExistence = function(objectID) {
  const d = Q.defer()
  AlgoliaIndex.getObject(objectID, function searchDone(err, content) {
    if (err && err.statusCode == 404) {
		  d.resolve(false)
    } else { // This isn't quite right
      logger.error(err)
      d.reject(err)
    }
	});
  return d.promise
}



describe('Bulk', function() {
  this.timeout(20000);
  const sender = 'vZweCaZEWlZPx0gpQn2b1B7DFAZ2';

  describe('API', function() {

    // const unlikelyQuery = "What is Lorem ipsum dolor sit amet, consectetur adipiscing elit?"
    // describe('Sending the unlikely query "' + unlikelyQuery + '" which won\'t bring back any results', function() {
    //   const results = {};
    //   before(function(done) {
    //     sendApiRequest(sender, unlikelyQuery, results, done)
    //   })
    //
    //   it('should be interpreted as a "query" or "Default Fallback Intent"', function(done) {
    //     assert(results.body.requestData.intent == 'query' || results.body.requestData.intent == 'Default Fallback Intent')
    //     done()
    //   })
    //   it('should bring back no results', function(done) {
    //     assert.equal(results.body.memories.length, 0)
    //     done()
    //   })
    // })

    const shortMessage = "A Simple Message"
    describe('Sending the short message "' + shortMessage + '"', function() {
      const results = {};
      before(function(done) {
        sendApiRequest(sender, shortMessage, results, done)
      })

      it('should be interpreted as a "query" or "Default Fallback Intent"', function(done) {
        assert(results.body.requestData.intent == 'query' || results.body.requestData.intent == 'Default Fallback Intent')
        done()
      })
      it('should bring back a result with a "description" or "content" parameter', function(done) {
        assert(results.body.memories[0].description || results.body.memories[0].content)
        done()
      })
    })

    const queryMessage = 'What\'s the company address?'
    const expectedQueryReturn = 'The Company Address is 123 Fake Street'
    describe('123 Sending the message "' + queryMessage + '"', function() {
      const results = {};
      before(function(done) {
        sendApiRequest(sender, queryMessage, results, done)
      });

      it('should be interpreted as a "query"', function(done) {
        assert.equal(results.body.requestData.intent, 'query')
        done()
      })
      it('should bring back a result with the "sentence" parameter "' + expectedQueryReturn + '"', function(done) {
        assert.equal(results.body.memories[0].description || results.body.memories[0].content, expectedQueryReturn)
        done()
      })
    })

    const message = "This is my cat"
    const expectedReturn = "This is your cat"
    describe('Sending the message "' + message + '"', function() {
      const results = {};
      before(function(done) {
        sendApiRequest(sender, message, results, done)
      });

      it('should be interpreted as a "store"', function(done) {
        assert.equal(results.body.requestData.intent, 'store')
        done()
      })
      it('should bring back a result with the "sentence" parameter "' + expectedReturn + '"', function(done) {
        assert.equal(results.body.memories[0].description, expectedReturn)
        done()
      })
    })

    describe('Date/Time-based Reminders', function() {

      const message2 = "Remind me to feed the cat in 5 mins"
      describe('Sending the message "' + message2 + '"', function() {
        const expectedIntent = "setTask.dateTime"

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message2, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...')
      })

      const message2a = "Remind me at 5pm to feed the cat"
      describe('Sending the message "' + message2a + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505620800000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message2a, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })

      const message3 = "Remind me at 5pm tomorrow to feed the cat"
      describe('Sending the message "' + message3 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505664000000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message3, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })

      const message4 = "Remind me tomorrow at 5pm to feed the cat"
      describe('Sending the message "' + message4 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505664000000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message4, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })

      const message5 = "Remind me tomorrow at 5pm to feed the cat, wash the dishes and clean the car"
      describe('Sending the message "' + message5 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505664000000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message5, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })

      const message6 = "Tomorrow afternoon remind me to feed the cat, wash the dishes and clean the car"
      describe('Sending the message "' + message6 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505664000000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message6, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })

      const message7 = "Next Thursday I need to feed the cat, wash the dishes and clean the car"
      describe('Sending the message "' + message7 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedDateTimeNum = 1505664000000

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message7, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
          // , function(done) {
          //   logger.trace(results.body.memories[0])
          //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
          //   done()
          // }
        )
      })
    })



    describe('URL-based Reminders', function() {
      const message5 = "Remind me to buy cat food next time I'm on Tesco.com"
      describe('Sending the message "' + message5 + '"', function() {
        const expectedIntent = "setTask.URL"
        const expectedURL = 'Tesco.com'

        const results = {};
        before(function(done) {
          sendApiRequest(sender, message5, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with the "triggerURL" parameter "' + expectedURL + '"', function(done) {
          assert.equal(results.body.memories[0].triggerURL, expectedURL)
          done()
        })
      })
    })


    after(function() {

    })
  });







  describe('Chatbot', function() {

    const unlikelyQuery = "What is Lorem ipsum dolor sit amet, consectetur adipiscing elit?"
    describe('Sending the unlikely query "' + unlikelyQuery + '" which won\'t bring back any results', function() {
      const expectedFragment = 'Sorry I couldn\'t find any memories related to that!'

      const results = {};
      before(function(done) {
        sendChatbotRequest(sender, unlikelyQuery, results, done)
      })

      it('should be interpreted as a "query" or "Default Fallback Intent"', function(done) {
        logger.debug(results.body.messageData[0].data)
        assert(results.body.requestData.intent == 'query' || results.body.requestData.intent == 'Default Fallback Intent')
        done()
      })
      // it('should bring back no results', function(done) {
      //   assert.equal(results.body.memories.length, 0)
      //   done()
      // })
      // it('should bring back a message saying it couldn\'t find anything', function(done) {
      //   assert(results.body.messageData[0].data.message.text.indexOf(expectedFragment) > -1)
      //   done()
      // })
    })

    const greeting = "Hello"
    describe('Sending the greeting "' + greeting + '"', function() {
      const results = {};
      before(function(done) {
        sendChatbotRequest(sender, greeting, results, done)
      })

      it('should be interpreted as a "greeting"', function(done) {
        assert(results.body.requestData.intent == 'greeting')
        done()
      })
      it('should return a message', function(done) {
        assert(results.body.messageData[0].data.message.text)
        done()
      })
    })

    const shortMessage = "Test Message"
    describe('Sending the chatbot1 short message "' + shortMessage + '"', function() {
      const results = {};
      before(function(done) {
        sendChatbotRequest(sender, shortMessage, results, done)
      })

      it('should return a message', function(done) {
        assert(results.body.messageData[0].data.message.text)
        done()
      })
      it('should bring back more quick reply options' /*, function(done) {
        assert(results.body.messageData[0].data.message.quick_replies && results.body.messageData[0].data.message.quick_replies.length)
        done()
      }*/)
    })

    const message1 = "This is my cat"
    describe('Sending the message "' + message1 + '"', function() {
      const expectedFragment = "I've now remembered that for you!"

      const results = {};
      before(function(done) {
        sendChatbotRequest(sender, message1, results, done)
      });

      it('should be say it\s remembered it for you', function(done) {
        assert(results.body.messageData[0].data.message.text.indexOf(expectedFragment) > -1)
        done()
      })
    })

    describe('Tasks', function() {

      const message2 = "Remind me to feed the cat in 5 mins"
      describe('Sending the message "' + message2 + '"', function() {
        const expectedIntent = "setTask.dateTime"
        const expectedFragment = "I've now set that reminder for you!"

        const results = {};
        before(function(done) {
          sendChatbotRequest(sender, message2, results, done)
        });

        it('should be interpreted as a ' + expectedIntent, function(done) {
          assert.equal(results.body.requestData.intent, expectedIntent)
          done()
        })
        it('should bring back a result with a "triggerDateTime" parameter', function(done) {
          logger.trace(results.body.memories[0])
          assert(results.body.memories[0].triggerDateTime)
          done()
        })
        it('should be say it\'s set that reminder for you', function(done) {
          assert(results.body.messageData[0].data.message.text.indexOf(expectedFragment) > -1)
          done()
        })
      })


      describe('Reminder sentence testing', function() {
        const localSender = '1300120880110773'
        const tests = [
          { weight: '5', sentence: 'Remind me to feed the cat in 5 mins', actionSentence: 'Feed the cat', delay: '0.00347222222222222',  },
          { weight: '5', sentence: 'Remind me at 5pm to feed the cat', actionSentence: 'Feed the cat', timeNextM: '0.708333333333333', dateTime: '2017-10-04T16:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me at 5pm tomorrow to feed the cat', actionSentence: 'Feed the cat', timeTomorrowM: '0.708333333333333', dateTime: '2017-10-05T16:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me tomorrow at 5pm to feed the cat', actionSentence: 'Feed the cat', timeTomorrowM: '0.708333333333333', dateTime: '2017-10-05T16:00:00.000Z',  },
          { weight: '4', sentence: 'Remind me tomorrow at 5pm to feed the cat, wash the dishes and clean the car', actionSentence: 'Feed the cat, wash the dishes and clean the car', timeTomorrowM: '0.708333333333333', dateTime: '2017-10-05T16:00:00.000Z',  },
          { weight: '4', sentence: 'Tomorrow afternoon remind me to feed the cat, wash the dishes and clean the car', actionSentence: 'Feed the cat, wash the dishes and clean the car', timeTomorrowM: '0.541666666666667', dateTime: '2017-10-05T13:00:00.000Z',  },
          // { weight: '4', sentence: 'Next Thursday I need to feed the cat, wash the dishes and clean the car', actionSentence: 'Feed the cat, wash the dishes and clean the car',  },
          { weight: '5', sentence: 'I need to clean the car tomorrow', actionSentence: 'Clean the car', timeTomorrowM: '0.333333333333333',  },
          // { weight: '5', sentence: 'remind me on Friday at 2 pm to send paperwork to new rainbow', actionSentence: 'Send paperwork to new rainbow', dateTime: '2017-10-04T13:00:00.000Z',  },
          // { weight: '5', sentence: 'On Friday at 2pm remind me to send paperwork to new rainbow ', actionSentence: 'Send paperwork to new rainbow', dateTime: '2017-09-29T13:00:00.000Z',  },
          // { weight: '5', sentence: 'I need to send paperwork to new rainbow at 2pm Friday ', actionSentence: 'Send paperwork to new rainbow', dateTime: '2017-09-29T13:00:00.000Z',  },
          // { weight: '5', sentence: 'remind me at 9 am on friday to collect reading books from library', actionSentence: 'Collect reading books from library', dateTime: '2017-10-04T08:00:00.000Z',  },
          // { weight: '5', sentence: 'At 9am on Friday I need to collect the reading books from library', actionSentence: 'Collect the reading books from library', dateTime: '2017-09-29T08:00:00.000Z',  },
          // { weight: '5', sentence: 'Remind me Friday at 9am I need to collect reading books from library', actionSentence: 'Collect reading books from library', dateTime: '2017-09-29T08:00:00.000Z',  },
          { weight: '2', sentence: 'Tomorrow at 10 am to take the meat loaf out of the freezer', actionSentence: 'Take the meat loaf out of the freezer', timeTomorrowM: '0.416666666666667', dateTime: '2017-10-05T09:00:00.000Z',  },
          { weight: '4', sentence: 'Remind me at 10am tomorrow to take the meat loaf out the freezer', actionSentence: 'Take the meat loaf out the freezer', timeTomorrowM: '0.416666666666667', dateTime: '2017-10-05T09:00:00.000Z',  },
          { weight: '5', sentence: 'remind me at 9 am tomorrow to phone danny and vet', actionSentence: 'Phone Danny and Vet', timeTomorrowM: '0.375', dateTime: '2017-10-05T08:00:00.000Z',  },
          { weight: '5', sentence: 'At 9am tomorrow I need to phone Danny and vet', actionSentence: 'Phone Danny and Vet', timeTomorrowM: '0.375', dateTime: '2017-10-05T08:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me tomorrow at 9am I should phone Danny and vet', actionSentence: 'Phone Danny and Vet', timeTomorrowM: '0.375', dateTime: '2017-10-05T08:00:00.000Z',  },
          { weight: '5', sentence: 'remind me tonight at 8 pm to email Nerissa', actionSentence: 'Email Nerissa', timeTodayM: '0.833333333333333', dateTime: '2017-10-04T19:00:00.000Z',  },
          { weight: '5', sentence: 'Tonight at 8pm I need to email Nerissa', actionSentence: 'Email Nerissa', timeTodayM: '0.833333333333333', dateTime: '2017-10-04T19:00:00.000Z',  },
          { weight: '5', sentence: 'I need to email Nerissa at 8pm tonight', actionSentence: 'Email Nerissa', timeTodayM: '0.833333333333333', dateTime: '2017-10-04T19:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me tomorrow at 2 pm to cancel flu jab', actionSentence: 'Cancel flu jab', timeTomorrowM: '0.583333333333333', dateTime: '2017-10-05T13:00:00.000Z',  },
          { weight: '5', sentence: 'Tomorrow at 2pm remind me to cancel flu jab', actionSentence: 'Cancel flu jab', timeTomorrowM: '0.583333333333333', dateTime: '2017-10-05T13:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me at 2pm tomorrow I need to cancel flu jab', actionSentence: 'Cancel flu jab', timeTomorrowM: '0.583333333333333', dateTime: '2017-10-05T13:00:00.000Z',  },
          { weight: '5', sentence: 'Remind me on Monday at 2 pm to set up emms standing order and cancel Halifax one', actionSentence: 'Set up emms standing order and cancel Halifax one', dateTime: '2017-10-04T13:00:00.000Z',  },
          { weight: '5', sentence: 'At 2pm on Monday I need to set up emms standing order and cancel Halifax one', actionSentence: 'Set up emms standing order and cancel Halifax one', dateTime: '2017-10-04T13:00:00.000Z',  },
          { weight: '4', sentence: 'Monday at 2pm I need to set up emms standing order and cancel Halifax one', actionSentence: 'Set up emms standing order and cancel Halifax one', dateTime: '2017-10-04T13:00:00.000Z',  },
          // { weight: '2', sentence: 'Remind me on Wednesday morning at 10 am to call vet', actionSentence: 'Call vet', dateTime: '2017-09-27T09:00:00.000Z',  },
          // { weight: '4', sentence: 'I need to call the vet at 10am on Wednesday ', actionSentence: 'Call the vet', dateTime: '2017-09-27T09:00:00.000Z',  },
          // { weight: '5', sentence: 'Remind me at 10am on Wednesday to call vet', actionSentence: 'Call vet', dateTime: '2017-09-27T09:00:00.000Z',  },
          { weight: '3', sentence: 'At 5 tomorrow I need to call home', actionSentence: 'Call home', dateTime: '2017-10-05T16:00:00.000Z',  },
          { weight: '3', sentence: 'At 11 tomorrow I need to call home', actionSentence: 'Call home', dateTime: '2017-10-05T10:00:00.000Z',  },
          { weight: '3', sentence: 'I need to call home at 9am', actionSentence: 'Call home', dateTime: '2017-10-05T08:00:00.000Z',  },
          { weight: '3', sentence: 'I need to call home at 9pm', actionSentence: 'Call home', dateTime: '2017-10-04T20:00:00.000Z',  },
          { weight: '3', sentence: 'Remind me at 9 to call home', actionSentence: 'Call home', dateTime: '2017-10-04T20:00:00.000Z',  },
          { weight: '3', sentence: 'Can you remind me at 11 to call home', actionSentence: 'Call home', dateTime: '2017-10-04T22:00:00.000Z',  },
          { weight: '3', sentence: 'I need to call home at 11:30', actionSentence: 'Call home', dateTime: '2017-10-04T22:30:00.000Z',  },
        ]
        var score = 0,
            total = 0
        tests.forEach(function(test) {
          describe('"' + test.sentence + '"', function() {
            const results = {}
            if (test.weight > 2) {
              before(function(done) {
                sendChatbotRequest(localSender, test.sentence, results, done)
              });
              it('"' + test.actionSentence + '"', function(done) {
                const aS = results.body.memories[0].actionSentence
                const passed = (aS.substring(2, aS.length).toLowerCase() == test.actionSentence.toLowerCase()) || (aS.substring(3, aS.length).toLowerCase() == test.actionSentence.toLowerCase())
                total += parseInt(test.weight)
                if (passed) {
                  score += parseInt(test.weight)
                } else {
                  logger.warn(aS)
                }
                assert(passed)
                done()
              })
              if (test.dateTime) {
                it('"' + test.dateTime + '"', function(done) {
                  const dT = results.body.memories[0].triggerDateTime
                  const passed = dT == test.dateTime
                  total += parseInt(test.weight)
                  if (passed) {
                    score += parseInt(test.weight)
                  } else {
                    // logger.info(dT)
                  }
                  assert(passed)
                  done()
                })
              }
            } else {
              total += parseInt(test.weight)
              it('"' + test.actionSentence + '"')
            }
          })
        })
        after(function() {
          logger.info('Final score: ' + score + ' / ' + total)
        })
      })




      describe('URL sentence testing', function() {
        const localSender = '1300120880110773'
        const tests = [
          { weight: '5', sentence: 'Remind me to buy this book next time I\'m on Amazon', actionSentence: 'Buy this book', urlBase: 'amazon',  },
          { weight: '5', sentence: 'Remind me when you\'re on ebay you need to buy gloves', actionSentence: 'Buy gloves', urlBase: 'ebay',  },
          { weight: '5', sentence: 'When I\'m next online I need to do my tax return', actionSentence: 'Do your tax return', urlBase: 'google',  },
          { weight: '5', sentence: 'Remind me to buy tuna from ocado', actionSentence: 'Buy tuna from Ocado', urlBase: 'ocado',  },
          { weight: '5', sentence: 'Next time I\'m on myprotein I need to buy some protein powder, shorts and vests', actionSentence: 'Buy some protein powder, shorts and vests', urlBase: 'myprotein',  },
          { weight: '5', sentence: 'I need to buy tuna when I\'m on tesco', actionSentence: 'Buy tuna', urlBase: 'tesco',  },
          { weight: '5', sentence: 'When I\'m on Trello I need to complete the onboarding checklist', actionSentence: 'Complete the onboarding checklist', urlBase: 'trello',  },
          // { weight: '5', sentence: 'i need to buy razors in my next amazon order', actionSentence: 'Buy razors', urlBase: 'amazon',  },
          { weight: '5', sentence: 'i need to book train tickets to hull next time im online', actionSentence: 'Book train tickets to hull', urlBase: 'google',  },
          // { weight: '5', sentence: 'Remind me to use ABC123 when I\'m on Airbnb for 50% off', actionSentence: 'Use ABC123 for 50% off', urlBase: 'airbnb',  },
          { weight: '5', sentence: 'Please remind me to post my holiday pic when I\'m on Instagram ', actionSentence: 'Post your holiday pic', urlBase: 'instagram',  },
          { weight: '5', sentence: 'Transfer money to John when I\'m on paypal', actionSentence: 'Transfer money to John', urlBase: 'paypal',  },
          // { weight: '5', sentence: 'Look at 123 Mapple Street when I\'m on right move', actionSentence: 'Look at 123 Mapple Street', urlBase: 'rightmove',  },
          // { weight: '5', sentence: 'Create a new board with interior design ideas on Pinterest', actionSentence: 'Create a new board with interior design ideas', urlBase: 'pinterest',  },
          // { weight: '5', sentence: 'Remind me we had 10% of operations left on Alogolia on tue 12th December', actionSentence: 'You had 10% of operations left on Alogolia on tue 12th December', urlBase: 'algolia',  },
          // { weight: '5', sentence: 'Order my next tesco delivery for 4pm on Sunday', actionSentence: 'Order your next delivery for 4pm on Sunday', urlBase: 'tesco',  },
          // { weight: '5', sentence: 'Read this article when I\'m on Medium', actionSentence: 'Read this article ', urlBase: 'medium',  },
          // { weight: '5', sentence: 'Book flight to milan when I\'m next online ', actionSentence: 'Book flight to Milan', urlBase: 'google',  },
          { weight: '5', sentence: 'Checkout the Boris Johnson article when I\'m on BBC', actionSentence: 'Checkout the Boris Johnson article', urlBase: 'bbc',  },
          // { weight: '5', sentence: 'I need to urgently buy dog food', actionSentence: 'Buy dog food ', urlBase: 'google',  },
          // { weight: '5', sentence: 'When I\'m on mens health remind me I\'m 82kg', actionSentence: 'You\'re 82kg ', urlBase: 'menshealth',  },
          // { weight: '5', sentence: 'I need to buy a new slide from argos', actionSentence: 'Buy a new slide', urlBase: 'argos',  },
          // { weight: '5', sentence: 'Book flight to milan next time I\'m online ',  },
          // { weight: '5', sentence: 'I really must order chicken from ocado', actionSentence: 'order chicken', urlBase: 'ocado',  },
        ]
        var score = 0,
            total = 0
        tests.forEach(function(test) {
          describe('"' + test.sentence + '"', function() {
            const results = {}
            if (test.weight > 2) {
              before(function(done) {
                sendChatbotRequest(localSender, test.sentence, results, done)
              });
              it('should have intent "setTask.URL"', function(done) {
                assert.equal(results.body.requestData.intent, 'setTask.URL')
                done()
              })
              it('"' + test.actionSentence + '"', function(done) {
                const aS = results.body.memories[0].actionSentence
                const passed = (aS.substring(2, aS.length).toLowerCase() == test.actionSentence.toLowerCase()) || (aS.substring(3, aS.length).toLowerCase() == test.actionSentence.toLowerCase())
                total += parseInt(test.weight)
                if (passed) {
                  score += parseInt(test.weight)
                } else {
                  logger.warn(aS)
                }
                assert(passed)
                done()
              })
              if (test.urlBase) {
                it('"' + test.urlBase + '"', function(done) {
                  const url = results.body.memories[0].triggerURL.replace('.com','').replace('.co.uk','').replace('.org','')
                  const passed = url.toLowerCase == test.urlBase.toLowerCase
                  total += parseInt(test.weight)
                  if (passed) {
                    score += parseInt(test.weight)
                  } else {
                    logger.info(url)
                  }
                  assert(passed)
                  done()
                })
              }
            } else {
              total += parseInt(test.weight)
              it('"' + test.actionSentence + '"')
            }
          })
        })
        after(function() {
          logger.info('Final score: ' + score + ' / ' + total)
        })
      })
    })




    describe('0001 Message sequences', function() {
      const message1 = "What is my name?"
      const code1 = "USER_FEEDBACK_MIDDLE"
      describe('Recall different memories, change to store, add attachment, change back and then request Carousel', function() {
        var resultList = []
        describe('!...Sending the message "' + message1 + '", followed by the quick reply "' + code1 + '"', function() {

          before(function() {
            const d = Q.defer()
            sendChatbotRequest(sender, message1)
            .then(function(res) {
              resultList.push(res)
              sendChatbotQuickReply(sender, code1)
              .then(function(res1) {
                resultList.push(res1)
                d.resolve()
              }).catch(function(e) {
                d.reject(e)
              })
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should ask what it should have done', function(done) {
            assert.equal(resultList[1].messageData[0].data.message.text, 'Whoops - was there something you would have preferred me to do?')
            done()
          })
          it('should bring back more quick reply options', function(done) {
            assert(resultList[1].messageData[0].data.message.quick_replies && resultList[1].messageData[0].data.message.quick_replies.length)
            done()
          })
        })

        const code2 = "CORRECTION_QUERY_DIFFERENT"
        describe('!...followed by the quick reply "' + code2 + '"', function() {

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code2)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should bring back a different result from the previous one', function(done) {
            assert.notEqual(resultList[0].messageData[0].data.message.text, resultList[2].messageData[0].data.message.text)
            done()
          })
        })

        const code3 = "CORRECTION_QUERY_TO_STORE"
        describe('...followed by the quick reply "' + code1 + '", then the quick reply "' + code3 + '"', function() {
          const expectedFragment = "I've now remembered that for you!"

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code1)
            .then(function(res) {
              resultList.push(res)
              sendChatbotQuickReply(sender, code3)
              .then(function(res1) {
                resultList.push(res1)
                d.resolve()
              }).catch(function(e) {
                d.reject(e)
              })
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should be say it\s remembered it for you', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment) > -1)
            done()
          })
        })

        const attachment1 = 'https://unsplash.it/200/300/?random'
        describe('...followed by the attachment "' + attachment1 + '"', function() {
          // const expectedFragment = "I've now remembered that for you!"

          before(function() {
            const d = Q.defer()
            sendChatbotAttachments(sender, attachment1, 'image')
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should bring back more quick reply options', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.quick_replies && resultList[resultList.length-1].messageData[0].data.message.quick_replies.length)
            done()
          })
          it('...which are not the default quick reply options')
        })

        const code5 = "CORRECTION_ADD_ATTACHMENT"
        describe('...followed by the quick reply "' + code5 + '"', function() {
          // const expectedFragment = "I've now remembered that for you!"

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code5)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should add an attachment to the memory', function(done) {
            assert(resultList[resultList.length-1].memories[0].attachments && resultList[resultList.length-1].memories[0].attachments.length)
            done()
          })
          it('should backup the attachment to Cloudinary')
        })

        const code1b = "USER_FEEDBACK_BOTTOM"
        const code6 = "CORRECTION_STORE_TO_QUERY"
        describe('...followed by the quick reply "' + code1b + '", then the quick reply "' + code6 + '"', function() {
          // const expectedFragment = "I've now remembered that for you!"

          before(function() {
            const d = Q.defer()
            // setTimeout(function() {
              sendChatbotQuickReply(sender, code1b)
              .then(function(res) {
                resultList.push(res)
                sendChatbotQuickReply(sender, code6)
                .then(function(res1) {
                  resultList.push(res1)
                  d.resolve()
                }).catch(function(e) {
                  d.reject(e)
                })
              }).catch(function(e) {
                d.reject(e)
              })
            // }, 5000)
            return d.promise
          });

          it('should delete the memory just stored'
            // , function(done) {
            //   checkMemoryExistence(resultList[resultList.length-1].memories[0].objectID)
            //   .then(function(result) {
            //     assert(!result)
            //     done()
            //   })
            // }
          )
          it('should be interpreted as a "query" or "Default Fallback Intent"', function(done) {
            assert(resultList[resultList.length-1].requestData.intent == 'query' || resultList[resultList.length-1].requestData.intent == 'Default Fallback Intent')
            done()
          })
        })

        const code7 = "CORRECTION_CAROUSEL"
        var specificMemory;
        describe('!...followed by the quick reply "' + code1 + '", then the quick reply "' + code7 + '"', function() {

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code1b)
            .then(function(res) {
              resultList.push(res)
              sendChatbotQuickReply(sender, code7)
              .then(function(res1) {
                resultList.push(res1)
                d.resolve()
              }).catch(function(e) {
                d.reject(e)
              })
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should show a carousel', function(done) {
            try {
              specificMemory = resultList[resultList.length-1].messageData[0].data.message.attachment.payload.elements[2].sentence
            } catch(e) {

            }
            assert(resultList[resultList.length-1].messageData[0].data.message && resultList[resultList.length-1].messageData[0].data.message.attachment && resultList[resultList.length-1].messageData[0].data.message.attachment.payload && resultList[resultList.length-1].messageData[0].data.message.attachment.payload.elements)
            done()
          })
        })

        const code8 = "REQUEST_SPECIFIC_MEMORY-data-2"
        describe('!...followed by a postback with payload "' + code8 + '"', function() {

          before(function() {
            const d = Q.defer()
            sendChatbotPostback(sender, code8)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should show the 3rd specific memory', function(done) {
            assert.equal(resultList[resultList.length-1].messageData[0].data.message && resultList[resultList.length-1].messageData[0].data.message.attachment && resultList[resultList.length-1].messageData[0].data.message.attachment.payload && resultList[resultList.length-1].messageData[0].data.message.attachment.payload.elements && resultList[resultList.length-1].messageData[0].data.message.attachment.payload.elements[0] && resultList[resultList.length-1].messageData[0].data.message.attachment.payload.elements[0].title, specificMemory)
            done()
          })
        })
      })


      describe('Send an attachment, hold it and then create the memory to add it to', function() {
        var resultList = []

        const attachment1 = 'https://unsplash.it/200/300/?random'
        describe('Send the attachment "' + attachment1 + '"', function() {

          before(function() {
            const d = Q.defer()
            sendChatbotAttachments(sender, attachment1, 'image')
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should bring back quick reply options', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.quick_replies && resultList[resultList.length-1].messageData[0].data.message.quick_replies.length)
            done()
          })
        })

        const code1 = "PREPARE_ATTACHMENT"
        describe('...followed by the quick reply "' + code1 + '"', function() {
          const expectedFragment = "Sure thing - type your message below and I'll attach it..."

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code1)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should be say type your message below', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment) > -1)
            done()
          })
        })

        const message1 = "This is my favourite random photo of all time"
        describe('...followed by the message "' + message1 + '"', function() {
          const expectedFragment1 = "I've now remembered that for you!"
          const expectedFragment2 = "favourite random photo"

          before(function() {
            const d = Q.defer()
            sendChatbotRequest(sender, message1)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('memory should have the message included', function(done) {
            assert(resultList[resultList.length-1].memories[0].description.indexOf(expectedFragment2) > -1)
            done()
          })
          it('memory should have an attachment included', function(done) {
            assert(resultList[resultList.length-1].memories[0].attachments && resultList[resultList.length-1].memories[0].attachments.length)
            done()
          })
          it('message should be say it\s remembered it for you', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment1) > -1)
            done()
          })
          it('message should have the message included', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment2) > -1)
            done()
          })
          it('message should have an attachment included', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.attachment && resultList[resultList.length-1].messageData[0].data.message.attachment.payload)
            done()
          })
        })
      })

      describe('Task: Send dateTime reminder without the dateTime details, then confirm dateTime and then reply with details', function() {
        var resultList = []

        const message1 = "Remind me to feed the cat"
        describe('Sending the message "' + message1 + '"', function() {
          const expectedIntent = "setTask.dateTime"

          before(function() {
            const d = Q.defer()
            sendChatbotRequest(sender, message1)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should be interpreted as a ' + expectedIntent, function(done) {
            assert.equal(resultList[resultList.length-1].requestData.intent, expectedIntent)
            done()
          })
          it('should bring back quick reply options', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.quick_replies && resultList[resultList.length-1].messageData[0].data.message.quick_replies.length)
            done()
          })
          it('should bring back quick reply options that are different from the default ones')
        })

        const code1 = "CORRECTION_GET_DATETIME"
        describe('...followed by the quick reply "' + code1 + '"', function() {
          const expectedFragment = "Sure thing - when shall I remind you?"

          before(function() {
            const d = Q.defer()
            sendChatbotQuickReply(sender, code1)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should ask when to remind you', function(done) {
            assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment) > -1)
            done()
          })
        })

        const message2 = "tomorrow at 5pm"
        describe('Sending the message "' + message2 + '"', function() {
          const expectedIntent = "provideDateTime"
          const expectedDateTimeNum = 1505664000000

          before(function() {
            const d = Q.defer()
            sendChatbotRequest(sender, message2)
            .then(function(res) {
              resultList.push(res)
              d.resolve()
            }).catch(function(e) {
              d.reject(e)
            })
            return d.promise
          });

          it('should be interpreted as a ' + expectedIntent, function(done) {
            assert.equal(resultList[resultList.length-1].requestData.intent, expectedIntent)
            done()
          })
          it('should bring back a result with a "triggerDateTime" parameter', function(done) {
            assert(resultList[resultList.length-1].memories[0].triggerDateTime)
            done()
          })
          it('should have triggerDateTime set as...' + expectedDateTimeNum + '"'
            // , function(done) {
            //   logger.trace(results.body.memories[0])
            //   assert.equal(new Date(results.body.memories[0].triggerDateTime).getTime(), expectedDateTimeNum)
            //   done()
            // }
          )
        })
      })
    })

    describe('Task: Send reminder without the details, then confirm URL and then reply with details', function() {
      var resultList = []

      const message1 = "Remind me to feed the cat"
      describe('Sending the message "' + message1 + '"', function() {
        const expectedIntents = [
          "setTask",
          "setTask.dateTime",
          "setTask.URL",
        ]

        before(function() {
          const d = Q.defer()
          sendChatbotRequest(sender, message1)
          .then(function(res) {
            resultList.push(res)
            d.resolve()
          }).catch(function(e) {
            d.reject(e)
          })
          return d.promise
        });

        it('should be interpreted as one of ' + expectedIntents.join(' or '), function(done) {
          assert(expectedIntents.indexOf(resultList[resultList.length-1].requestData.intent) > -1)
          done()
        })
        it('should bring back quick reply options', function(done) {
          assert(resultList[resultList.length-1].messageData[0].data.message.quick_replies && resultList[resultList.length-1].messageData[0].data.message.quick_replies.length)
          done()
        })
        it('should bring back quick reply options that are different from the default ones')
      })

      const code1 = "CORRECTION_GET_URL"
      describe('...followed by the quick reply "' + code1 + '"', function() {
        const expectedFragment = "Sure thing - what's the url?"

        before(function() {
          const d = Q.defer()
          sendChatbotQuickReply(sender, code1)
          .then(function(res) {
            resultList.push(res)
            d.resolve()
          }).catch(function(e) {
            d.reject(e)
          })
          return d.promise
        });

        it('should ask what the URL is', function(done) {
          assert(resultList[resultList.length-1].messageData[0].data.message.text.indexOf(expectedFragment) > -1)
          done()
        })
      })

      const message2 = "Facebook"
      describe('Sending the message "' + message2 + '"', function() {
        const expectedIntent = "provideURL"
        const expectedURL = 'facebook.com'

        before(function() {
          const d = Q.defer()
          sendChatbotRequest(sender, message2)
          .then(function(res) {
            resultList.push(res)
            d.resolve()
          }).catch(function(e) {
            d.reject(e)
          })
          return d.promise
        });

        it('should be interpreted as a ' + expectedIntent
          , function(done) {
            assert.equal(resultList[resultList.length-1].requestData.intent, expectedIntent)
            done()
          }
        )
        it('should bring back a result with the "triggerURL" parameter "' + expectedURL + '"', function(done) {
          assert.equal(resultList[resultList.length-1].memories[0].triggerURL, expectedURL)
          done()
        })
      })
    })
  })

  describe('Messenger', function() {
    describe('Say hello', function() {
      it('should return a greeting')
    })
    describe('Request a memory', function() {
      it('should return the memory')
    })
    describe('Request a long memory', function() {
      it('should return the memory in multiple parts')
    })
    describe('Request a memory with an attachment', function() {
      it('should return the memory plus attachment in multiple parts')
    })
    describe('Store a memory', function() {
      it('should store the memory')
      it('should return the memory')
    })
    describe('Store a long memory', function() {
      it('should store the memory')
      it('should return the memory in multiple parts')
    })
    describe('Store a memory with an attachment', function() {
      it('should store the memory plus attachment')
      it('should return the memory plus attachment in multiple parts')
    })
    describe('Set a dateTime reminder', function() {
      it('should store the memory')
      it('should set the reminder')
      it('should somehow ping the reminder back???')
    })
    describe('Set a URL-based reminder', function() {
      it('should store the memory')
    })
  })

  describe('Slack', function() {
    const slackKeychain = {
      bot_access_token: 'xoxb-252522692578-W3sj1kTnLfSKjup8Vc4TTvRm',
      bot_user_id: 'D7EH3CKCL'
    }
    const messageTemplate = {
      type: 'message',
      channel: 'D7EH3CKCL',
      user: 'U04NVHJFD',
      ts: '1514506085.000191',
      source_team: 'T04NVHJBK',
      team: 'T04NVHJBK'
    }
    const reactionTemplate = {
      type: 'reaction_added',
      user: 'U04NVHJFD',
      item: {
        type: 'message',
        channel: 'C7BQBL138',
        ts: '1514722340.000081'
      },
      item_user: 'U04NVHJFD',
      event_ts: '1514722424.000052',
      ts: '1514722424.000052'
    }
    const sendSlackMessage = async text => {
      const message = JSON.parse(JSON.stringify(messageTemplate))
      message.text = text
      return await slack.handleMessage(slackKeychain, message)
    }
    const sendSlackReaction = async reaction => {
      const message = JSON.parse(JSON.stringify(reactionTemplate))
      message.reaction = reaction
      return await slack.handleMessage(slackKeychain, message)
    }
    describe('Say hello', function() {
      var result
      before(async () => {
        result = await sendSlackMessage('hi')
        return
      })
      it('should return to the correct recipient', () => {
        logger.debug(result[0])
        assert.equal(result[0].recipient, messageTemplate.channel)
      })
      it('should return a text message', () => {
        assert(result[0].text)
      })
      it('should return a greeting', () => {
        assert(['Hello there!', 'Nice to see you', 'Hi 😊', 'Hello 🙂'].indexOf(result[0].text) > -1)
      })
    })
    describe('Ask how often Savvy indexes files', function() {
      var result
      before(async () => {
        result = await sendSlackMessage('How often does Savvy index files?')
        return
      })
      it('should return a text message', () => {
        logger.debug(result)
        assert(result[0].text)
      })
      it('should return the answer', () => {
        assert.equal(result[0].text, 'How often does Savvy index files?\n\n- Every 60 seconds')
      })
    })
    describe('Ask a question that wants a file', function() {
      var result
      before(async () => {
        result = await sendSlackMessage('What is the innovation file?')
        return
      })
      it('should return a text message', () => {
        logger.debug(result)
        assert(result[0].text)
      })
      it('should return an answer', () => {
        assert.equal(result[0].text, 'Here\'s what I found:')
      })
      it('should return only files', () => {
        logger.debug(result[0].params.attachments)
        result[0].params.attachments.filter(attachment => attachment.author_name).forEach(attachment => {
          assert.notEqual(attachment.author_name.indexOf('From: '), 0)
        })
      })
    })
    describe('Manually filter to just files', function() {
      var result
      before(async () => {
        await sendSlackMessage('What\'s the Savvy colour?')
        result = await slack.interactive(JSON.parse( '{"type":"interactive_message","actions":[{"name":"filter-type","type":"button","selected_options":[{"value":"file", "text":"Give me just file results"}]}],"callback_id":"results-options__What\'s%20the%20Savvy%20colour%3F","team":{"id":"T04NVHJBK","domain":"explaain"},"channel":{"id":"C7BQBL138","name":"bot-testing"},"user":{"id":"U04NVHJFD","name":"jeremy"},"action_ts":"1515101782.306526","message_ts":"1514506085.000191","attachment_id":"1","token":"Yrn00Mm2UXAMpEGrSc5GYTpF","is_app_unfurl":false,"original_message":{"text":"Here\'s what I '
          + 'found:","username":"ForgetMeNot_local","bot_id":"B7DRNAZ0Q","attachments":[{"callback_id":"vZweCaZEWlZPx0gpQn2b1B7DFAZ2","fallback":"Oops, you can\'t quick-reply","footer":"Quick'
          + 'actions","id":1,"color":"FED33C","actions":[{"id":"1","name":"USER_FEEDBACK_TOP","text":"\\ud83d\\ude0d","type":"button","value":"\\ud83d\\ude0d","style":""},{"id":"2","name":"USER_FEEDBACK_MIDDLE","text":"\\u270f\\ufe0f","type":"button","value":"\\u270f\\ufe0f","style":""},{"id":"3","name":"USER_FEEDBACK_BOTTOM","text":"\\ud83d\\ude14","type":"button","value":"\\ud83d\\ude14","style":""}]},{"author_name":"From: Savvy 1 pager - Generic","title":"What is Savvy?\\n\\n- Savvy is an app'
          + 'that lives where you work. It works on its own website, via a browser extension and Slack. It connects to the tools you use at work, like Google Drive, Dropbox, Trello and more, and allows you to find the answers to the questions you have wherever you are.\\n- You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and'
          + 'documents to answer your question.","id":2,"color":"645AEF","fallback":"What is Savvy?\\n\\n- Savvy is an app that lives where you work. It works on its own website, via a browser extension and Slack. It connects to the tools you use at work, like Google Drive, Dropbox, Trello and more, and allows you to find the answers to the questions you have wherever you are.\\n- You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial'
          + 'projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and documents to answer your question."},{"id":3,"fields":[{"title":"Created","value":"Tue Oct 31 2017","short":true},{"title":"Modified","value":"Fri Dec 01 2017","short":true}],"fallback":"[no preview available]"},{"author_name":"From: Savvy For Publishers","text":"What is Savvy?","id":4,"fallback":"What is Savvy?"},{"author_name":"From: Savvy 1 pager -'
          + 'Generic","text":"You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and documents to answer your question.","id":5,"fallback":"You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d'
          + 'It\\u2019ll return links to the best files and documents to answer your question."}],"type":"message","subtype":"bot_message","ts":"1514506085.000191"},"response_url":"https:\\/\\/hooks.slack.com\\/actions\\/T04NVHJBK\\/294374436274\\/f9EO0Mo8HKwbA65D7gV1RKND","trigger_id":"294405711476.4777596393.887022949ae4a6b337c02f1a794a3beb"}'
        ))
        return result
      })
      it('should return a text message', () => {
        logger.debug(result)
        assert(result[0].text)
      })
      it('should have the same message id as the previous one', () => {
        assert(result[0].text)
      })
      it('should return an answer', () => {
        assert.equal(result[0].text, 'Here\'s what I found:')
      })
      it('should return only files', () => {
        logger.debug(result[0].params.attachments)
        result[0].params.attachments.filter(attachment => attachment.author_name).forEach(attachment => {
          assert.notEqual(attachment.author_name.indexOf('From: '), 0)
        })
      })
    })
    describe('Store the company address', function() {
      var result
      before(async () => {
        result = await sendSlackMessage('The company address is 123 Fake Street')
        return
      })
      it('should return a text message', () => {
        assert(result[0].text)
      })
      it('should return confirmation', () => {
        assert.equal(result[0].text, 'I\'ve now remembered that for you! The company address is 123 Fake Street')
      })
    })
    describe('Store by reacting to a previous message', function() {
      var result
      before(async () => {
        result = await sendSlackReaction('paperclip')
        return
      })
      it('should return a text message', () => {
        assert(result[0].text)
      })
      it('should return confirmation', () => {
        assert.equal(result[0].text, 'I\'ve now remembered that for you! Testing testing')
      })
    })
    describe('Store (plus title) by reacting to a previous message', function() {
      var result
      before(async () => {
        result = await sendSlackReaction('linked_paperclips')
        return
      })
      it('should return a text message', () => {
        assert(result[0].text)
      })
      it('should return confirmation', () => {
        assert.equal(result[0].text, 'I\'ve now remembered that for you! My very important Question\n\nYour very important Answer')
      })
    })
    describe('Ask a question, then ask for more results', function() {
      var result
      before(async () => {
        await sendSlackMessage('What\'s the Savvy purple colour?')
        result = await slack.interactive(JSON.parse( '{"type":"interactive_message","actions":[{"name":"results","type":"button","value":"more-results","text":"Give me more results"}],"callback_id":"results-options__What\'s%20the%20Savvy%20purple%20colour%3F","team":{"id":"T04NVHJBK","domain":"explaain"},"channel":{"id":"C7BQBL138","name":"bot-testing"},"user":{"id":"U04NVHJFD","name":"jeremy"},"action_ts":"1515101782.306526","message_ts":"1515101537.000341","attachment_id":"1","token":"Yrn00Mm2UXAMpEGrSc5GYTpF","is_app_unfurl":false,"original_message":{"text":"Here\'s what I '
          + 'found:","username":"ForgetMeNot_local","bot_id":"B7DRNAZ0Q","attachments":[{"callback_id":"vZweCaZEWlZPx0gpQn2b1B7DFAZ2","fallback":"Oops, you can\'t quick-reply","footer":"Quick'
          + 'actions","id":1,"color":"FED33C","actions":[{"id":"1","name":"USER_FEEDBACK_TOP","text":"\\ud83d\\ude0d","type":"button","value":"\\ud83d\\ude0d","style":""},{"id":"2","name":"USER_FEEDBACK_MIDDLE","text":"\\u270f\\ufe0f","type":"button","value":"\\u270f\\ufe0f","style":""},{"id":"3","name":"USER_FEEDBACK_BOTTOM","text":"\\ud83d\\ude14","type":"button","value":"\\ud83d\\ude14","style":""}]},{"author_name":"From: Savvy 1 pager - Generic","title":"What is Savvy?\\n\\n- Savvy is an app'
          + 'that lives where you work. It works on its own website, via a browser extension and Slack. It connects to the tools you use at work, like Google Drive, Dropbox, Trello and more, and allows you to find the answers to the questions you have wherever you are.\\n- You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and'
          + 'documents to answer your question.","id":2,"color":"645AEF","fallback":"What is Savvy?\\n\\n- Savvy is an app that lives where you work. It works on its own website, via a browser extension and Slack. It connects to the tools you use at work, like Google Drive, Dropbox, Trello and more, and allows you to find the answers to the questions you have wherever you are.\\n- You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial'
          + 'projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and documents to answer your question."},{"id":3,"fields":[{"title":"Created","value":"Tue Oct 31 2017","short":true},{"title":"Modified","value":"Fri Dec 01 2017","short":true}],"fallback":"[no preview available]"},{"author_name":"From: Savvy For Publishers","text":"What is Savvy?","id":4,"fallback":"What is Savvy?"},{"author_name":"From: Savvy 1 pager -'
          + 'Generic","text":"You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d It\\u2019ll return links to the best files and documents to answer your question.","id":5,"fallback":"You interact with it in natural language. You can ask it questions like, \\u201cwhere are the latest financial projections\\u201d or \\u201cwhat\\u2019s our holiday policy?\\u201d'
          + 'It\\u2019ll return links to the best files and documents to answer your question."}],"type":"message","subtype":"bot_message","ts":"1515101537.000341"},"response_url":"https:\\/\\/hooks.slack.com\\/actions\\/T04NVHJBK\\/294374436274\\/f9EO0Mo8HKwbA65D7gV1RKND","trigger_id":"294405711476.4777596393.887022949ae4a6b337c02f1a794a3beb"}'
        ))
        return result
      })
      it('should return a text message', () => {
        logger.debug(result[0])
        assert(result[0].text)
      })
      it('should return results', () => {
        assert.equal(result[0].text, 'Here\'s what I found:')
      })
      it('should return the correct result', () => {
        logger.debug(result[0].params.attachments)
        assert.equal(result[0].params.attachments[0].title, 'Brand colours:\n\n- Orange: #EF9A3B\n- Pink: #D62459\n- Blue: #409AD5\n- Green: #34BA9C\n- Orange/Red Blend: #EA6466\n- Purple: #645AEF')
      })
    })

    describe('Search Strategy', function() {
      const slackKeychain = {
        bot_access_token: 'xoxb-252522692578-W3sj1kTnLfSKjup8Vc4TTvRm',
        bot_user_id: 'D7EH3CKCL'
      }
      const messageTemplate = {
        type: 'message',
        channel: 'D7EH3CKCL',
        user: 'U04NVHJFD',
        ts: '1514506085.000191',
        source_team: 'T04NVHJBK',
        team: 'T04NVHJBK'
      }
      const reactionTemplate = {
        type: 'reaction_added',
        user: 'U04NVHJFD',
        item: {
          type: 'message',
          channel: 'C7BQBL138',
          ts: '1514722340.000081'
        },
        item_user: 'U04NVHJFD',
        event_ts: '1514722424.000052',
        ts: '1514722424.000052'
      }
      const sendSlackMessage = async text => {
        const message = JSON.parse(JSON.stringify(messageTemplate))
        message.text = text
        return await slack.handleMessage(slackKeychain, message)
      }
      const sendSlackReaction = async reaction => {
        const message = JSON.parse(JSON.stringify(reactionTemplate))
        message.reaction = reaction
        return await slack.handleMessage(slackKeychain, message)
      }
      const searches = [
        {
          query: 'What is the purple colour?',
          correctSnippet: 'brand colours'
        },
        {
          query: 'where is the alpha crm',
          correctSnippet: 'sales crm - alpha targets'
        },
        {
          query: 'where is the belron application',
          correctSnippet: 'belron/drive/auto'
        },
        {
          query: 'what are our urgent priority guidelines',
          correctSnippet: 'These are our Urgent Priority'
        },
        {
          query: 'where is the features scorecard sheet',
          correctSnippet: 'Feature set: Savvy for Slack'
        },
        {
          query: 'what is slits url',
          correctSnippet: 'Slite: The note app '
        },
        {
          query: 'what is <http:www.marketingagencies.org.uk|www.marketingagencies.org.uk> contact page',
          correctSnippet: 'Contact — MAA'
        },
        {
          query: 'where are the public faqs',
          correctSnippet: 'public faqs'
        },
        {
          query: 'what is included in our 14 day trial',
          correctSnippet: '14 day trial'
        },
        {
          query: 'what is included in our 14 day free trial',
          correctSnippet: '14 day trial'
        },
        {
          query: 'where is the astronaut illustration',
          correctSnippet: 'undraw_Astronaut_0o7w.png'
        },
        {
          query: 'what is alex from geovations email',
          correctSnippet: 'Name: Alex Wrottesley'
        },
        {
          query: '',
          correctSnippet: ''
        },
        {
          query: '',
          correctSnippet: ''
        },
        {
          query: '',
          correctSnippet: ''
        },
        {
          query: '',
          correctSnippet: ''
        },
      ]
      searches.filter(search => search.query && search.query.length).forEach(search => {
        describe('Ask: ' + search.query, function() {
          var result
          before(async () => {
            result = await sendSlackMessage(search.query)
            return
          })
          it('should return: ' + (search.correctAnswer ? search.correctAnswer.substring(0, 50) : '...' + search.correctSnippet.substring(0, 50)) + '...', () => {
            logger.debug(result[0].params.attachments[0].title.substring(0, 50) + '...')
            if (search.correctAnswer)
              assert.equal(result[0].params.attachments[0].title, search.correctAnswer)
            else
              assert(search.correctSnippet && search.correctSnippet.length && result[0].params.attachments[0].title.toLowerCase().indexOf(search.correctSnippet.toLowerCase()) > -1)
          })
        })
      })
    })
  })
  describe('Database', () => {
    const index = process.env.ALGOLIA_ORG_INDEX
    const data = {
      hello: 'hi',
      __goodbye: 'bye',
      deeper: {
        one: '1111',
        two: '2222'
      },
      slack: {
        __botUserID: '12345765',
        __botAccessToken: '12345543',
        __accessToken: '12345234'
      },
      deeper2: [
        'one1111',
        'two2222'
      ]
    }
    const keys = Object.keys(data)
    const savedKeys = keys.concat(['objectID'])
    const checkEveryKeyInObject = (obj, ftn) => {
      Object.keys(obj).forEach(key => {
        if (typeof obj[key] === 'object' || typeof obj[key] === 'array')
          checkEveryKeyInObject(obj[key], ftn)
        else
          ftn(key, obj[key])
      })
    }
    const checkEveryKeyInTwoObjects = (obj1, obj2, ftn) => {
      Object.keys(obj1).forEach(key => {
        if (typeof obj1[key] === 'object' || typeof obj1[key] === 'array')
          checkEveryKeyInTwoObjects(obj1[key], obj2[key], ftn)
        else
          ftn(key, obj1[key], obj2[key])
      })
    }
    var savedData
    describe('Encrypt and store data', () => {
      before(async () => savedData = await Encrypt.setData(index, data))

      it('should be successfully encrypted', () => {
        checkEveryKeyInObject(savedData, (key, val) => {
          if (key.substring(0, 2) === '__') {
            assert(typeof val === 'string')
            assert(val.length === 44)
          }
        })
      })
      it('should be successfully saved', () => {
        checkEveryKeyInTwoObjects(data, savedData, (key, val1, val2) => {
          assert(val2)
        })
      })
    })
    describe('Retrieve and decrypt data', () => {
      var retrievedData
      before(async () => {
        await new Promise(function(resolve, reject) {
          setTimeout(() => resolve(), 2000)
        })
        retrievedData = await Encrypt.getData(index, savedData.objectID)
      })

      it('should be successfully retrieved', () => {
        checkEveryKeyInTwoObjects(data, retrievedData, (key, val1, val2) => {
          assert(val2)
        })
      })
      it('should be successfully decrypted', () => {
        checkEveryKeyInTwoObjects(data, retrievedData, (key, val1, val2) => {
          assert(val1 === val2)
        })
      })
    })
  })

  after(function() {
    describe('0001 Clearup', function() {
      describe('Deleting all memories just created', function() {
        logger.trace(temporaryMemories)
        temporaryMemories.forEach(function(memory, i) {
          if (memory.objectID) {
            describe('Deleting memory #' + i, function() {
              const results = {};
              before(function(done) {
                sendApiDeleteRequest(memory.userID, memory.objectID, results, done)
              });

              it('should be successfully deleted', function(done) {
                logger.trace(results)
                assert(results)
                done()
              })
            })
          }
        })
      })
    })
  })
});
