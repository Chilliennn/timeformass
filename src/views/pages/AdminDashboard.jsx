import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';

function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!session) { navigate('/login'); return; }

      const email = session.user.email;
      const { data: adminRow } = await supabase.from('admin').select('admin_id, name, email').eq('email', email).maybeSingle();
      if (!adminRow) { navigate('/login'); return; }
      setAdmin(adminRow);
    }
    check();
  }, [navigate]);

  if (!admin) return <div>Loading...</div>;
  return (
    <div>
      <h1>Welcome, {admin.name}</h1>
      <p>Admin dashboard placeholder</p>
      <button onClick={async () => { await supabase.auth.signOut(); sessionStorage.removeItem('admin'); localStorage.removeItem('admin'); navigate('/'); }}>Logout</button>
    </div>
  );
}

export default AdminDashboard;