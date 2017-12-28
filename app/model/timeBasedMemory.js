// grab the things we need
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// create a schema for memories that have a time
var timeMemorySchema = new Schema({
  name: String,
  fb_id: { type: String, required: true },
  subject: { type: String, required: true },
  value: { type: String, required: true }
},{
  timestamps: true
});

// we need to create a model using it
var memory = mongoose.model('time_reminder', timeMemorySchema);

// make this available to our users in our Node applications
module.exports = memory;
