import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '../auth/AuthContext';
import { AuthShell } from '../components/auth/AuthShell';
import { getDashboardPathByRole } from '../utils/roles';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const getSignInErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { status?: number; data?: { detail?: string } } }).response;
    const detail = response?.data?.detail;
    if (detail) {
      return detail;
    }
    if (response?.status === 401) {
      return 'Invalid email or password';
    }
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_NETWORK'
  ) {
    return 'Cannot reach the API server. Start backend on http://localhost:8000 and try again.';
  }

  return 'Unable to sign in right now. Please try again.';
};

export const SignInPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to={getDashboardPathByRole(user.role)} replace />;
  }

  const validate = () => {
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      nextErrors.email = 'Email is required';
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = 'Enter a valid email';
    }
    if (!password) {
      nextErrors.password = 'Password is required';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    setIsSubmitting(true);
    try {
      const loggedInUser = await signIn(email.trim(), password);
      const fromState = location.state as { from?: string } | null;
      const redirect = fromState?.from || getDashboardPathByRole(loggedInUser.role);
      toast.success('Signed in successfully');
      navigate(redirect, { replace: true });
    } catch (error) {
      toast.error(getSignInErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      label="Welcome back"
      title={
        <>
          Sign in to your
          <br />
          <em>MindWell dashboard</em>
        </>
      }
      description="Continue with your role-based workspace to manage wellness operations, teams, and insights securely."
      topActionLabel="Back to Home"
      topActionTo="/"
      features={[
        { title: 'Role-Aware Access', description: 'Automatic routing to each role dashboard.' },
        { title: 'Secure by Default', description: 'JWT auth with protected API and route guards.' },
      ]}
    >
      <h2 className="mw-auth-form-title">Sign In</h2>
      <p className="mw-auth-form-subtitle">Use your assigned account credentials.</p>

      <form onSubmit={handleSubmit} className="mw-form-stack">
        <label htmlFor="email" className="mw-field">
          <span className="mw-field-label">Email</span>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mw-input"
            placeholder="name@company.com"
          />
          {errors.email ? <span className="mw-field-error">{errors.email}</span> : null}
        </label>

        <label htmlFor="password" className="mw-field">
          <span className="mw-field-label">Password</span>
          <div className="mw-input-group">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mw-input mw-input-with-toggle"
              placeholder="Enter password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="mw-input-toggle"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password ? <span className="mw-field-error">{errors.password}</span> : null}
        </label>

        <button type="submit" disabled={isSubmitting} className="mw-btn-primary mw-btn-block">
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="mw-auth-footer-link">
          Invited user?{' '}
          <Link to="/signup" className="mw-inline-link">
            Complete signup with invitation code
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};
