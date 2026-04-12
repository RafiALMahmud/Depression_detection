import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { invitationsApi } from '../api/services';
import { AuthShell } from '../components/auth/AuthShell';

const CODE_PATTERN = /^\d{9}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface FieldErrors {
  email?: string;
  invitationCode?: string;
  fullName?: string;
  password?: string;
  confirmPassword?: string;
}

export const InvitationSignupPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [invitationCode, setInvitationCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isValidating, setIsValidating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validatedRole, setValidatedRole] = useState<string | null>(null);
  const [validatedCompany, setValidatedCompany] = useState<string | null>(null);
  const [validatedDepartment, setValidatedDepartment] = useState<string | null>(null);
  const [invitationValidated, setInvitationValidated] = useState(false);

  useEffect(() => {
    if (searchParams.get('email')) {
      setInvitationValidated(false);
    }
  }, [searchParams]);

  const validationSummary = useMemo(() => {
    const parts: string[] = [];
    if (validatedRole) parts.push(validatedRole.replace('_', ' '));
    if (validatedCompany) parts.push(validatedCompany);
    if (validatedDepartment) parts.push(validatedDepartment);
    return parts.join(' | ');
  }, [validatedRole, validatedCompany, validatedDepartment]);

  const validateInputs = (): boolean => {
    const nextErrors: FieldErrors = {};
    if (!email.trim()) {
      nextErrors.email = 'Email is required';
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = 'Enter a valid email';
    }
    if (!CODE_PATTERN.test(invitationCode.trim())) {
      nextErrors.invitationCode = 'Invitation code must be exactly 9 digits';
    }
    if (!fullName.trim()) {
      nextErrors.fullName = 'Full name is required';
    }
    if (!password) {
      nextErrors.password = 'Password is required';
    } else if (password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters';
    }
    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Confirm your password';
    } else if (confirmPassword !== password) {
      nextErrors.confirmPassword = 'Passwords do not match';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const checkInvitation = async () => {
    const nextErrors: FieldErrors = {};
    if (!email.trim()) nextErrors.email = 'Email is required';
    if (!CODE_PATTERN.test(invitationCode.trim())) nextErrors.invitationCode = 'Invitation code must be exactly 9 digits';
    if (Object.keys(nextErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...nextErrors }));
      return;
    }

    setIsValidating(true);
    try {
      const response = await invitationsApi.validate({
        email: email.trim().toLowerCase(),
        invitation_code: invitationCode.trim(),
      });
      if (!response.valid) {
        setInvitationValidated(false);
        toast.error(response.message || 'Invalid invitation');
        return;
      }
      setInvitationValidated(true);
      if (response.full_name) {
        setFullName(response.full_name);
      }
      setValidatedRole(response.role);
      setValidatedCompany(response.company_name);
      setValidatedDepartment(response.department_name);
      toast.success('Invitation validated');
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      toast.error(message || 'Failed to validate invitation');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateInputs()) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await invitationsApi.signup({
        email: email.trim().toLowerCase(),
        invitation_code: invitationCode.trim(),
        full_name: fullName.trim(),
        password,
        confirm_password: confirmPassword,
      });
      toast.success(response.message || 'Signup completed successfully');
      navigate('/sign-in', { replace: true });
    } catch (error) {
      const message =
        typeof error === 'object' && error !== null && 'response' in error
          ? (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      toast.error(message || 'Signup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      label="Invitation onboarding"
      title={
        <>
          Complete your
          <br />
          <em>MindWell signup</em>
        </>
      }
      description="Enter your email and 9-digit invitation code from the welcome email, then set your password to activate your account."
      topActionLabel="Go to Sign In"
      topActionTo="/sign-in"
      features={[
        {
          title: 'Need your code?',
          description: 'Ask your admin to resend the invitation if your previous code expired.',
        },
        {
          title: 'Invited users only',
          description: 'Signup completes only after invitation email and code verification.',
        },
      ]}
      footerNote={
        invitationValidated ? (
          <div className="mw-subtle-banner">
            <p className="mw-section-label">Invitation verified</p>
            <p className="mw-helper-text">{validationSummary || 'Invitation details confirmed'}</p>
          </div>
        ) : null
      }
    >
      <h2 className="mw-auth-form-title">Signup</h2>
      <p className="mw-auth-form-subtitle">Invited users only.</p>

      <form onSubmit={handleSubmit} className="mw-form-stack">
        <label htmlFor="email" className="mw-field">
          <span className="mw-field-label">Email</span>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setInvitationValidated(false);
            }}
            className="mw-input"
            placeholder="name@company.com"
          />
          {errors.email ? <span className="mw-field-error">{errors.email}</span> : null}
        </label>

        <label htmlFor="invitation-code" className="mw-field">
          <span className="mw-field-label">9-Digit Invitation Code</span>
          <div className="mw-form-actions-row">
            <div className="mw-field">
              <input
                id="invitation-code"
                type="text"
                inputMode="numeric"
                value={invitationCode}
                onChange={(event) => {
                  const sanitized = event.target.value.replace(/\D/g, '').slice(0, 9);
                  setInvitationCode(sanitized);
                  setInvitationValidated(false);
                }}
                className="mw-input"
                placeholder="123456789"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                void checkInvitation();
              }}
              className="mw-btn-ghost"
              disabled={isValidating}
            >
              {isValidating ? 'Checking...' : 'Validate'}
            </button>
          </div>
          {errors.invitationCode ? <span className="mw-field-error">{errors.invitationCode}</span> : null}
        </label>

        <label htmlFor="full-name" className="mw-field">
          <span className="mw-field-label">Full Name</span>
          <input
            id="full-name"
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="mw-input"
            placeholder="Your full name"
          />
          {errors.fullName ? <span className="mw-field-error">{errors.fullName}</span> : null}
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
              placeholder="Create password"
            />
            <button
              type="button"
              className="mw-input-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password ? <span className="mw-field-error">{errors.password}</span> : null}
        </label>

        <label htmlFor="confirm-password" className="mw-field">
          <span className="mw-field-label">Confirm Password</span>
          <div className="mw-input-group">
            <input
              id="confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mw-input mw-input-with-toggle"
              placeholder="Repeat password"
            />
            <button
              type="button"
              className="mw-input-toggle"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
            >
              {showConfirmPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.confirmPassword ? <span className="mw-field-error">{errors.confirmPassword}</span> : null}
        </label>

        <button type="submit" disabled={isSubmitting} className="mw-btn-primary mw-btn-block">
          {isSubmitting ? 'Completing signup...' : 'Complete Signup'}
        </button>

        <p className="mw-auth-footer-link">
          Already activated?{' '}
          <Link to="/sign-in" className="mw-inline-link">
            Sign in now
          </Link>
        </p>
      </form>
    </AuthShell>
  );
};
