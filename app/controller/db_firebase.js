exports.save = data => new Promise(function(resolve, reject) {
  axios({
    method: 'post',
    url: 'https://us-central1-savvy-96d8b.cloudfunctions.net/saveCard',
    data: data
  }).then(res => {
    resolve(res)
  }).catch(e => {
    console.log('📛  Error!', e)
    reject(e)
  })
})
