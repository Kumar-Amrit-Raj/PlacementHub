import { NavLink } from 'react-router';
import { useAuth } from '../features/auth/AuthContext.jsx';
export default function RoleNavigation() {
  const { status, user } = useAuth();
  if (status !== 'authenticated')
    return <span className="header-note">Make room for what’s next.</span>;
  const destination = {
    student: ['/student/profile', 'My profile'],
    recruiter: ['/recruiter/profile', 'Company profile'],
    admin: ['/admin/companies', 'Company reviews'],
  }[user.role];
  return (
    <nav aria-label="Main navigation">
      <NavLink to="/account">Account</NavLink>
      {destination && <NavLink to={destination[0]}>{destination[1]}</NavLink>}
      {['student', 'recruiter'].includes(user.role) && (
        <NavLink to={'/' + user.role + '/opportunities'}>Opportunities</NavLink>
      )}
      {['student', 'recruiter'].includes(user.role) && (
        <NavLink to={'/' + user.role + '/applications'}>
          {user.role === 'student' ? 'My Applications' : 'Applications'}
        </NavLink>
      )}
    </nav>
  );
}
