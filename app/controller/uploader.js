// Cloudinary setup
const cloudinary = require('cloudinary')
cloudinary.config({
  cloud_name: 'forgetmenot',
  api_key: '645698655223266',
  api_secret: 'j2beHW2GZSpQ_zq_8bkmnWgW95k'
})

exports.upload = (recipientId, attachmentType, attachmentURL) => new Promise(function(resolve, reject) {
  console.log('upload', recipientId, attachmentType, attachmentURL)
  cloudinary.uploader.upload(attachmentURL, function(result, error) {
    if (error) {
      logger.error(error)
      reject(error)
    } else {
      resolve(result.url)
    }
  });
})
