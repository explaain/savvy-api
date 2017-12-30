const tracer = require('tracer')
const logger = tracer.colorConsole({level: 'debug'})
const sinon = require('sinon')
const axios = require("axios");
const Algolia = require('../controller/db_algolia')

if (process.env.NODE_ENV === "test") {
  const sandbox = sinon.sandbox.create()
  const testUser = {
    'slack': 'D7EH3CKCL',
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

exports.getUserByPlatform = async function(platform, id) {
  logger.trace('getUserByPlatform', platform, id)
  const user = platform ? await AlgoliaUsers.getFirstFromSearch({
    filters: platform + ': ' + id
  }) : await AlgoliaUsers.getObject(id)
  console.log(user);
  user.uid = user.objectID
  if (user.uid === undefined) console.log('user!!!!!')
  // delete user.objectID
  delete user._highlightResult
  console.log(user);
  return user
}

exports.authenticateSender = user => new Promise((resolve, reject) => {
  // var error
  if (!user) throw new Error('No user data provided')
  if (!user.uid) throw new Error('No user uid provided')
  if (!user.idToken) throw new Error('No user idToken provided')
  // if (error) console.error(error); reject(error)

  FirebaseAdmin.auth().verifyIdToken(user.idToken)
  .then(function(decodedToken) {
    var uid = decodedToken.uid;
    if (user.uid == uid) {
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
      track('User joined', {
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


fetchUserDataFromDb = function(userID) {
	logger.trace('fetchUserDataFromDb', userID)
	return AlgoliaUsers.getObject(userID)
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

exports.fetchUserData = (userID, forceRefresh) => new Promise((resolve, reject) => {
  logger.trace('fetchUserData', userID, forceRefresh)
  if (!forceRefresh && (userData = getLocalUser(userID).userData)) {
    resolve(userData)
  } else {
    fetchUserDataFromDb(userID)
    .then(function(userData) {
      resolve(userData)
    }).catch(function(e) {
      if (e.statusCode == 404 || e.statusCode == '404') {
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
