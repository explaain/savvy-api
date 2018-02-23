const sgMail = require('@sendgrid/mail')
sgMail.setApiKey(process.env.SENDGRID_API_KEY)

console.log('SIFTER RUNNING');

exports.save = data => {
  // using SendGrid's v3 Node.js Library
  // https://github.com/sendgrid/sendgrid-nodejs
  const subject = data.title
  const text = '#c:Design, #m:v1\n' + data.description
  console.log('📩 Sending to Sifter!', subject, text);
  const msg = {
    to: 'issue+ebea999988e21dfdd6175dbd79f6f9582904@savvy.sifterapp.com',
    from: 'jeremy@heysavvy.com',
    subject: subject,
    text: text,
  }
  sgMail.send(msg)
}
