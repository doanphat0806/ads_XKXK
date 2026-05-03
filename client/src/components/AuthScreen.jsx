import React, { useState } from 'react';
import { useAppContext } from '../contexts/AppContext';

export default function AuthScreen() {
  const { login } = useAppContext();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [provider, setProvider] = useState('facebook');

  const handleLogin = (e) => {
    e.preventDefault();
    login(user, pass, provider);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Đăng nhập quản trị</h1>
        <form onSubmit={handleLogin}>
          <div className="form-grid auth-form-grid">
            <div className="form-group full">
              <label>Nền tảng</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="facebook">Facebook</option>
                <option value="shopee">Shopee</option>
              </select>
            </div>
            <div className="form-group full">
              <label>Tài khoản</label>
              <input 
                type="text" 
                placeholder="admin" 
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
            <div className="form-group full">
              <label>Mật khẩu</label>
              <input 
                type="password" 
                placeholder="admin" 
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
