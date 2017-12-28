// grab the things we need
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// create a schema
var userSchema = new Schema({
  name: String,
  fb_id: { type: String, required: true, unique: true },
  location: { type: String, required: true }
},{
  timestamps: true
});

// the schema is useless so far
// we need to create a model using it
var user = mongoose.model('users', userSchema);

// make this available to our users in our Node applications
module.exports = user;
