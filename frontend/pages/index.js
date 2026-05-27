import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { authAPI, paymentAPI, notificationAPI } from '../lib/api';
import toast from 'react-hot-toast';
export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [payments, setPayments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [payForm, setPayForm] = useState({ amount: '', description: '', currency: 'USD' });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('token')) { router.push('/login'); return; }
    loadData();
  }, []);
  const loadData = async () => {
    try {
      const { data } = await authAPI.me();
      setUser(data.user);
      const [pays, notifs] = await Promise.allSettled([paymentAPI.myPayments(), notificationAPI.byUser(data.user._id)]);
      if (pays.status === 'fulfilled') setPayments(pays.value.data.payments);
      if (notifs.status === 'fulfilled') setNotifications(notifs.value.data.notifications);
    } catch { localStorage.removeItem('token'); router.push('/login'); }
  };
  const handlePayment = async (e) => {
    e.preventDefault(); if (!payForm.amount) return toast.error('Enter amount'); setLoading(true);
    try {
      const { data } = await paymentAPI.create(payForm);
      toast.success(data.message); setPayForm({ amount: '', description: '', currency: 'USD' }); await loadData();
    } catch (err) { toast.error(err?.response?.data?.error || 'Payment failed'); }
    finally { setLoading(false); }
  };
  const totalSpent = payments.filter(p => p.status === 'completed').reduce((s, p) => s + parseFloat(p.amount), 0);
  if (!user) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading...</div>;
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <nav className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">☸️</span>
          <div><div className="font-bold text-white text-lg">EKS MicroPay</div>
          <div className="text-xs text-slate-400">Production microservices demo</div></div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-300">👤 <b>{user.name}</b> <span className="ml-1 text-xs bg-blue-600 px-2 py-0.5 rounded-full">{user.role}</span></span>
          <button onClick={() => { localStorage.removeItem('token'); router.push('/login'); }}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-medium">Logout</button>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-5">
            <div className="text-blue-200 text-sm">Total Payments</div>
            <div className="text-3xl font-bold mt-1">{payments.length}</div>
          </div>
          <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-xl p-5">
            <div className="text-green-200 text-sm">Total Spent</div>
            <div className="text-3xl font-bold mt-1">${totalSpent.toFixed(2)}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-600 to-purple-800 rounded-xl p-5">
            <div className="text-purple-200 text-sm">Notifications</div>
            <div className="text-3xl font-bold mt-1">{notifications.length}</div>
          </div>
        </div>
        <div className="flex gap-2 mb-6">
          {[['overview','📊 Payments'],['pay','💳 Make Payment'],['notifications','🔔 Notifications']].map(([tab,label]) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab===tab ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>
        {activeTab === 'overview' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 font-semibold">Transaction History</div>
            {payments.length === 0 ? <div className="px-6 py-12 text-center text-slate-500">No payments yet!</div> : (
              <table className="w-full">
                <thead><tr className="text-slate-400 text-xs uppercase">
                  {['Txn ID','Amount','Status','Description','Date'].map(h => <th key={h} className="px-6 py-3 text-left">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-700">
                  {payments.map(p => (
                    <tr key={p.id} className="hover:bg-slate-750">
                      <td className="px-6 py-4 font-mono text-xs text-slate-400">{p.transaction_id}</td>
                      <td className="px-6 py-4 font-semibold">{p.currency} {parseFloat(p.amount).toFixed(2)}</td>
                      <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-medium ${p.status==='completed' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>{p.status}</span></td>
                      <td className="px-6 py-4 text-slate-400 text-sm">{p.description || '—'}</td>
                      <td className="px-6 py-4 text-slate-400 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {activeTab === 'pay' && (
          <div className="max-w-md">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-6">💳 New Payment</h2>
              <form onSubmit={handlePayment} className="space-y-4">
                <div><label className="block text-sm text-slate-400 mb-1">Amount</label>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00" value={payForm.amount}
                    onChange={e => setPayForm({...payForm, amount: e.target.value})}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 text-lg" /></div>
                <div><label className="block text-sm text-slate-400 mb-1">Currency</label>
                  <select value={payForm.currency} onChange={e => setPayForm({...payForm, currency: e.target.value})}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500">
                    {['USD','EUR','GBP','INR'].map(c => <option key={c}>{c}</option>)}
                  </select></div>
                <div><label className="block text-sm text-slate-400 mb-1">Description</label>
                  <input type="text" placeholder="What's this for?" value={payForm.description}
                    onChange={e => setPayForm({...payForm, description: e.target.value})}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" /></div>
                <button type="submit" disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-lg font-semibold transition-colors">
                  {loading ? 'Processing...' : 'Process Payment'}
                </button>
              </form>
            </div>
          </div>
        )}
        {activeTab === 'notifications' && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700 font-semibold">Notifications</div>
            {notifications.length === 0 ? <div className="px-6 py-12 text-center text-slate-500">No notifications yet.</div> : (
              <div className="divide-y divide-slate-700">
                {notifications.map(n => (
                  <div key={n.id} className="px-6 py-4 flex items-start gap-3">
                    <span className="text-xl">{n.type === 'payment' ? '💳' : '🔔'}</span>
                    <div><div className="font-medium text-sm">{n.subject}</div>
                      <div className="text-slate-400 text-sm mt-0.5">{n.message}</div>
                      <div className="text-slate-600 text-xs mt-1">{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
