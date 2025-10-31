import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './views/pages/Home.jsx';
import Login from './views/pages/Login.jsx';
import AdminDashboard from './views/pages/AdminDashboard.jsx';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;