import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient.js';
import { useNavigate } from 'react-router-dom';
import './Login.css';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, _setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);  
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    _setLoading(true);

    // 1) sign in with Supabase Auth
    const { data: _authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      setError(authError.message || 'Invalid credentials');
      _setLoading(false);
      return;
    }

    // 2) fetch admin metadata by email
    const { data: adminRow, error: adminErr } = await supabase
      .from('admin')
      .select('admin_id, parish_id, name, email, auth_uid')
      .eq('email', email)
      .maybeSingle();

    if (adminErr || !adminRow) {
      setError('Login succeeded but admin profile missing');
      _setLoading(false);
      return;
    }

    // 3) store admin metadata locally, choose session or local by rememberMe
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem('admin', JSON.stringify(adminRow));

    _setLoading(false);
    navigate('/admin');
  };

  return (
    <div className="login-container">
      <div className="login-left">
        <div className="login-form-wrapper">
          <button 
            className="back-button"
            onClick={() => navigate('/')}
          >
            ← Back to Home
          </button>

          <h1 className="login-title">Welcome back!</h1>
          <p className="login-subtitle">Enter your credentials to access your account</p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email" className="form-label">Email address</label>
              <input
                type="email"
                id="email"
                className="form-input"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <div className="label-row">
                <label htmlFor="password" className="form-label">Password</label>
                <a href="#" className="forgot-link">Forgot password?</a>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className="form-input"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 3L21 21M10.5 10.677C9.75388 11.4635 9.75388 12.7291 10.5 13.5156C11.2461 14.3021 12.4539 14.3021 13.2 13.5156M10.5 10.677L13.2 13.5156M10.5 10.677L7.5 7.5M13.2 13.5156L16.5 16.5M7.5 7.5C5.20389 8.81895 3.5 11.2498 3.5 12C3.5 12.7502 5.20389 15.181 7.5 16.5M7.5 7.5L4.5 4.5M16.5 16.5C18.7961 15.181 20.5 12.7502 20.5 12C20.5 11.2498 18.7961 8.81895 16.5 7.5M16.5 16.5L19.5 19.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 5C8.24261 5 5.43602 7.4404 3.76737 9.43934C2.51521 10.9394 2.51521 13.0606 3.76737 14.5607C5.43602 16.5596 8.24261 19 12 19C15.7574 19 18.564 16.5596 20.2326 14.5607C21.4848 13.0606 21.4848 10.9394 20.2326 9.43934C18.564 7.4404 15.7574 5 12 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="remember-me">
              <input
                type="checkbox"
                id="remember"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <label htmlFor="remember">Remember me</label>
            </div>

            {error && <div className="error-message">{error}</div>}

            <button 
              type="submit" 
              className="login-button"
              disabled={loading}
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>

      <div className="login-right">
        <img src="/pope-leo.jpg" alt="Pope celebrating Mass" className="login-image" />
      </div>
    </div>
  );
}

export default Login;