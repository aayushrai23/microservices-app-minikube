require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const notifRoutes = require('./routes/notification');
const { connectDB } = require('./db');
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(morgan('dev'));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));
app.use('/api/notify', notifRoutes);
const start = async () => {
  await connectDB();
  app.listen(process.env.PORT || 3003, () => console.log('Notification Service running on port 3003'));
};
start();
