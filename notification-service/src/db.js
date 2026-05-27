const mongoose = require('mongoose');

// MongoDB connection with retry logic
const connectDB = async () => {
  let retries = 10;
  while (retries) {
    try {
      await mongoose.connect(
        process.env.MONGO_URI || 'mongodb://localhost:27017/notificationdb'
      );
      console.log('✅ Notification DB connected (MongoDB)');
      return;
    } catch (err) {
      retries--;
      console.log(`DB not ready, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to MongoDB after retries');
};

// Notification Schema — PostgreSQL ki notifications table ka equivalent
const notificationSchema = new mongoose.Schema({
  user_id:    { type: String, required: true },
  type:       { type: String, default: 'general' },
  subject:    { type: String },
  message:    { type: String, required: true },
  email:      { type: String },
  status:     { type: String, default: 'sent' },
  created_at: { type: Date,   default: Date.now }
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { connectDB, Notification };
