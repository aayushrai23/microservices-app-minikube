import axios from 'axios';

const AUTH_URL         = '/api/auth';
const PAYMENT_URL      = '/api/payment';
const NOTIFICATION_URL = '/api/notify';

const getToken = () =>
  typeof window !== 'undefined' ? localStorage.getItem('token') : null;

const h = () => ({ Authorization: 'Bearer ' + getToken() });

export const authAPI = {
  register: (d) => axios.post(AUTH_URL + '/register', d),
  login:    (d) => axios.post(AUTH_URL + '/login', d),
  me:       ()  => axios.get(AUTH_URL + '/me', { headers: h() }),
};

export const paymentAPI = {
  create:     (d) => axios.post(PAYMENT_URL, d, { headers: h() }),
  myPayments: ()  => axios.get(PAYMENT_URL + '/my', { headers: h() }),
};

export const notificationAPI = {
  byUser: (id) => axios.get(NOTIFICATION_URL + '/user/' + id),
};
