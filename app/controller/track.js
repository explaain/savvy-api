// grab the Mixpanel factory
const Mixpanel = require('mixpanel');
const axios = require('axios');
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

exports.slack = (eventName, details, data) => {
  console.log('Sending to Slack:', eventName, details, data)
  axios.post('https://hooks.zapier.com/hooks/catch/3134011/kv4k3j/', {
    event_name: eventName,
    event_details: details,
    data: data
  })
}
