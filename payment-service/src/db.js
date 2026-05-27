const mongoose = require('mongoose');

// MongoDB connection with retry logic
const connectDB = async () => {
  let retries = 10;
  while (retries) {
    try {
      await mongoose.connect(
        process.env.MONGO_URI || 'mongodb://localhost:27017/paymentdb'
      );
      console.log('✅ Payment DB connected (MongoDB)');
      return;
    } catch (err) {
      retries--;
      console.log(`DB not ready, retrying... (${retries} left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to MongoDB after retries');
};

// Payment Schema — PostgreSQL ki payments table ka equivalent
const paymentSchema = new mongoose.Schema({
  user_id:        { type: String,  required: true },
  amount:         { type: Number,  required: true },
  currency:       { type: String,  default: 'USD' },
  status:         { type: String,  default: 'pending' },
  description:    { type: String },
  payment_method: { type: String,  default: 'card' },
  transaction_id: { type: String },
  created_at:     { type: Date,    default: Date.now }
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { connectDB, Payment };
