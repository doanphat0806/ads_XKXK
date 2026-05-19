import React, { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';

export default function AuthScreen() {
  const { login } = useAppContext();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

  const detectProvider = (username) => {
    const normalizedUser = username.toLowerCase().trim();
    if (normalizedUser === 'admin1' || normalizedUser === 'phat') return 'shopee';
    if (normalizedUser === 'oder') return 'oder';
    if (normalizedUser === 'kho') return 'kho';
    return 'facebook';
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const provider = detectProvider(user);
    login(user, pass, provider);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Đăng nhập quản trị</h1>
        <form onSubmit={handleLogin}>
          <div className="form-grid auth-form-grid">
            <div className="form-group full">
              <label>Tài khoản</label>
              <input 
                type="text" 
                placeholder="" 
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
            <div className="form-group full">
              <label>Mật khẩu</label>
              <input 
                type="password" 
                placeholder="" 
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>
          </div>
          <div className="form-actions auth-form-actions">
            <button type="submit" className="btn btn-g">
              Đăng nhập
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
