// DEPENDENCIES
require('dotenv').config();

var express = require('express');
var cors = require('cors')
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var map = require('./app/config/properties.js');

var mongoose = require('mongoose');

var apiController = require('./app/controller/chatbot');

var api = require('./app/routes/api');
var users = require('./app/routes/users');
var webhooks = require('./app/routes/webhooks');
var notifications = require('./app/routes/notifications')
var analytics = require('./app/routes/analytics')

var app = express();

app.use(cors())

// MongoDB database
// mongoose.connect('mongodb://localhost/ForgetMeTest');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/', express.static('./app/views'));
app.use('/api', api);
app.use('/users', users);
app.use('/notify', notifications);
app.use('/webhook', webhooks);
app.use('/analytics', analytics);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

module.exports = app;
