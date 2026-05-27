import { useState } from 'react';
import { useRouter } from 'next/router';
import { authAPI } from '../lib/api';
import toast from 'react-hot-toast';
export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data } = mode === 'login'
        ? await authAPI.login({ email: form.email, password: form.password })
        : await authAPI.register(form);
      localStorage.setItem('token', data.token);
      toast.success(mode === 'login' ? 'Welcome back!' : 'Account created!');
      router.push('/');
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.response?.data?.errors?.[0]?.msg || 'Something went wrong');
    } finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">☸️</div>
          <h1 className="text-2xl font-bold text-white">EKS MicroPay</h1>
          <p className="text-slate-400 text-sm mt-1">Microservices on AWS EKS</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
          <div className="flex bg-slate-700 rounded-lg p-1 mb-6">
            {['login','register'].map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-medium capitalize transition-all ${mode===m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {m === 'login' ? '🔐 Login' : '✨ Register'}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm text-slate-400 mb-1">Full Name</label>
                <input type="text" placeholder="John Doe" required value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input type="email" placeholder="john@example.com" required value={form.email}
                onChange={e => setForm({...form, email: e.target.value})}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Password</label>
              <input type="password" placeholder="••••••••" required value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-lg font-semibold transition-colors">
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
