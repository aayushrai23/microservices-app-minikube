const mongoose = require('mongoose');

// MongoDB connection with retry logic
const connectDB = async () => {
  let retries = 10;
  while (retries) {
    try {
      await mongoose.connect(
        process.env.MONGO_URI || 'mongodb://localhost:27017/authdb'
      );
      console.log('✅ Auth DB connected (MongoDB)');
      return;
    } catch (err) {
      retries--;
      console.log(`DB not ready, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to MongoDB after retries');
};

// User Schema — MongoDB ka table equivalent
const userSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  role:       { type: String, default: 'user' },
  created_at: { type: Date,   default: Date.now }
});

// Model — MongoDB ka table ka naam
const User = mongoose.model('User', userSchema);

module.exports = { connectDB, User };
