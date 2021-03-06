const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'})
const sinon = require('sinon')
const axios = require("axios");
const crypto = require("crypto")
const track = require('../controller/track')
const Algolia = require('../controller/db_algolia')

var FirebaseAdmin = require("firebase-admin")
var serviceAccount = require("./firebaseKeySavvy.json") // Secret file
FirebaseAdmin.initializeApp({
  credential: FirebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://savvy-96d8b.firebaseio.com"
}, 'savvy') // Giving it a name so we're allowed to have this alongside the existing app (forgetmenot) - need to consolidate!

if (process.env.NODE_ENV === "test") {
  console.log('Environment is test!!!')
  const sandbox = sinon.sandbox.create()
  const testUser = {
    'slack': 'U04NVHJFD',
    'organisationID': 'explaain',
    'first': 'Jeremy',
    'last': 'Evans',
    'algoliaApiKey': '88bd0a77faff65d4ace510fbf172a4e1',
    'objectID': 'vZweCaZEWlZPx0gpQn2b1B7DFAZ2'
  }
  sandbox.stub(Algolia, 'Index').returns({
    getObject: () => new Promise(function(resolve, reject) {
      resolve(testUser)
    }),
    searchObjects: () => new Promise((resolve, reject) => {
      resolve({ hits: [testUser] })
    }),
    getFirstFromSearch: () => new Promise((resolve, reject) => {
      resolve(testUser)
    }),
    deleteObject: () => new Promise((resolve, reject) => { resolve() })
  })
}

const AlgoliaUsers = new Algolia.Index(process.env.ALGOLIA_APP, process.env.ALGOLIA_ADMIN_API_KEY, process.env.ALGOLIA_USERS_INDEX)
const AlgoliaOrgs = new Algolia.Index(process.env.ALGOLIA_APP, process.env.ALGOLIA_ADMIN_API_KEY, process.env.ALGOLIA_ORG_INDEX)

/**
 * Takes sender data and returns User object from database
 *
 * @param  {Object} sender
 * @param  {String} platform
 * @return {Object}
 */
exports.getUserFromSender = async function(sender, platform) {
  logger.debug('getUserFromSender', sender, platform)
  var user
  if (!platform) platform = 'firebase'
  try {
    const res = await axios.post(process.env.NLP_SERVER + '/get-user', { idToken: sender.idToken })
    user = {
      data: res.data.results,
      objectID: res.data.results.objectID
    }
  } catch (e) {
    console.log(e)
  }
  console.log('user:', user)
  if (user && user.objectID) {
    user.idToken = sender.idToken
    user.platformSpecific = sender
    user.uid = user.objectID
    user.organisationID = user.data.organisationID
    if (sender.role) user.role = sender.role
    if (user._highlightResult) delete user._highlightResult
    return user
  } else {
    console.log('Couldn\'t find a user from these sender details:', sender)
    return false
  }
}

exports.authenticateSender = user => new Promise((resolve, reject) => {
  logger.debug('authenticateSender', user)
  // var error
  if (!user) throw new Error('No user data provided')
  if (!user.firebase && !user.uid) throw new Error('No user \'firebase\' or uid provided')
  if (!user.idToken) throw new Error('No user idToken provided')
  // if (error) console.error(error); reject(error)

  FirebaseAdmin.auth().verifyIdToken(user.idToken)
  .then(function(decodedToken) {
    var uid = decodedToken.uid;
    if (user.firebase == uid || user.uid == uid) {
      logger.info('🔑👤  User Authentication Succcessful!')
      resolve()
    } else {
      const e = { statusCode: 400, message: '❌ 🔑  User UID doesn\'t match accessToken' }
      logger.error(e.message)
      reject(e)
    }
  }).catch(function(error) {
    logger.error(error)
    const e = { statusCode: 400, message: '❌ 🔑  User authentication failed: ' + ( error.errorInfo.code === 'auth/argument-error' ? ' The Firebase ID token expired!' : 'Unknown issue' ) }
    logger.error(e.message)
    reject(e)
  })
})

exports.checkPermissions = function(organisationID, user) {
  return new Promise((resolve, reject) => {
    const data = {
      organisationID: organisationID,
      userID: user.uid
    }
    axios({
      method: 'post',
      url: 'https://us-central1-savvy-96d8b.cloudfunctions.net/checkPermissions',
      data: data
    }).then(function(response) {
      logger.info('🔑🖇  User Permissions Check Succcessful!')
      // console.log('📪  The response data!', response.data)
      resolve()
    }).catch(function(error) {
      logger.error(error)
      const e = { statusCode: 400, message: '❌ 🔑  User permission checking failed' }
      logger.error(e.message)
      logger.debug('[FOR DEBUGGING] organisationID:', organisationID)
      logger.debug('[FOR DEBUGGING] user:', user)
      reject(e)
    })
  })
}

exports.getUserData = function(organisationID, user) {
  return new Promise((resolve, reject) => {
    const data = {
      organisationID: organisationID,
      userID: user.uid
    }
    axios({
      method: 'post',
      url: 'https://us-central1-savvy-96d8b.cloudfunctions.net/getUserData',
      data: data
    }).then(function(response) {
      logger.info('👤  User Data Received!', response.data)
      track('User data fetched', {
        organisationID: organisationID,
        userID: user.uid
      })
      resolve(response.data)
    }).catch(function(error) {
      logger.error(error)
      const e = { statusCode: 400, message: '❌ 🔑  User data retrieval failed' }
      logger.error(e.message)
      reject(e)
    })
  })
}

exports.getUserTeamDetails = function(organisationID, user) {
  return new Promise((resolve, reject) => {
    const data = {
      organisationID: organisationID,
      userID: user.uid
    }
    axios({
      method: 'post',
      url: 'https://us-central1-savvy-96d8b.cloudfunctions.net/getUserTeamDetails',
      data: data
    }).then(function(response) {
      logger.info('👤  User\'s Team Details Received!', response.data)
      resolve(response.data)
    }).catch(function(error) {
      logger.error(error)
      const e = { statusCode: 400, message: '❌ 🔑  User team details retrieval failed' }
      logger.error(e.message)
      reject(e)
    })
  })
}

exports.createUserFromSlack = async slackUser => {
  logger.trace('createUserFromSlack', slackUser)
  // Get org data
  const organisation = await AlgoliaOrgs.getObject(slackUser.team)
  // Create user object
  const user = {
    slack: slackUser.user,
    slackTeam: slackUser.team,
    organisationID: organisation.name,
    algoliaApiKey: organisation.algolia.apiKey,
    objectID: slackUser.user,
    uid: slackUser.user
  }
  logger.trace(user)
  // Save user object
  await AlgoliaUsers.saveObject(user, user)

  logger.info('👤  User Joined and User Data Saved!', user)
  const allUsers = await AlgoliaOrgs.searchObjects({ query: '' })
  user.totalUsers = allUsers.length
  track.event('User joined', user)
  return user
}

exports.addUserToOrganisation = function(organisationID, user, verifiedEmails) {
  return new Promise((resolve, reject) => {
    const data = {
      organisationID: organisationID,
      userID: user.uid,
      verifiedEmails: verifiedEmails
    }
    axios({
      method: 'post',
      url: 'https://us-central1-savvy-96d8b.cloudfunctions.net/addUserToOrganisation',
      data: data
    }).then(function(response) {
      logger.info('👤  User Joined and User Data Received!', response.data)
      track.event('User joined', {
        organisationID: organisationID,
        userID: user.uid
      })
      resolve(response.data)
    }).catch(function(error) {
      logger.error(error)
      const e = { statusCode: 400, message: '❌ 🔑  User joining and getting data failed' }
      logger.error(e.message)
      reject(e)
    })
  })
}


fetchUserDataFromDb = async function(user) {
	logger.trace('fetchUserDataFromDb', user)
  if (typeof user === 'string') {
    console.log('string!');
    // @TODO: Deal with this case - sentry??
    // return AlgoliaUsers.getObject(user)
  } else {
    console.log('object!');
    res = await axios.post(process.env.NLP_SERVER + '/get-user', { idToken: user.idToken })
    return res.data.results
    // const filters = Object.keys(user).map(key => key + ':\'' + user[key] + '\'').join(' AND ')
    // console.log(filters);
    // return AlgoliaUsers.getFirstFromSearch({ filters: filters})
    // return AlgoliaUsers.getFirstFromFilters({ filters: filters})
  }
}



const createUserAccount = function(userData) {
	logger.trace(createUserAccount, userData)
  try {
    userData.dateCreated = new Date()
  	// Generate the value to be used for the Secure API key
  	const searchOnlyApiKey = userData.objectID + '_' + crypto.randomBytes(12).toString('hex');

  	// Generate Secure API token using this value
  	const params = {
  		filters: 'userID:' + userData.objectID + ' OR public = true',
  		restrictIndices: process.env.ALGOLIA_INDEX,
  		userToken: userData.objectID
  	};
  	var publicKey = AlgoliaClient.generateSecuredApiKey(searchOnlyApiKey, params);
  	// Save userData to 'users' Algolia index
  	userData.searchOnlyApiKey = searchOnlyApiKey;

  	//Save it to current memory
  	getLocalUser(userData.objectID).userData = userData;
  } catch(e) {
    logger.error(e)
  }
	return AlgoliaUsers.addObject(userData)
}

exports.fetchUserData = (user, forceRefresh) => new Promise((resolve, reject) => {
  logger.trace('fetchUserData', user, forceRefresh)
  userID = user.uid || user.objectID
  if (!forceRefresh && (userData = getLocalUser(userID).userData)) {
    resolve(userData)
  } else {
    fetchUserDataFromDb(user)
    .then(function(userData) {
      resolve(userData)
    }).catch(function(e) {
      if (e.statusCode == 404 || e.statusCode == '404') {
        // @TODO: remove this since savvy-nlp should handle creation of new accounts
        createUserAccount({objectID: userID})
        .then(function(userData) {
          resolve(userData)
        }).catch(function(e) {
          logger.error(e)
          reject(e)
        })
      } else {
        logger.error(e)
        reject(e)
      }
    })
  }
})


const getLocalUser = function(userID) {
	if (!global.users)
		global.users = {}
	if (!global.users[userID])
		global.users[userID] = {}
	return global.users[userID]
}


exports.fetchUserDataFromDb = fetchUserDataFromDb
