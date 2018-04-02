// grab the Mixpanel factory
const Mixpanel = require('mixpanel');
// create an instance of the mixpanel client
const mixpanel = Mixpanel.init('e3b4939c1ae819d65712679199dfce7e')

exports.event = (name, data) => new Promise(function(resolve, reject) {
  console.log('👣  Tracking ' + name + ' event:', data)
  try {
    mixpanel.track(name, data)
    .then(res => {
      console.log(res)
      resolve(res)
    }).catch(e => {
      console.log(e)
      reject(e)
    })
  } catch (e) {
    reject(e)
  }
})
