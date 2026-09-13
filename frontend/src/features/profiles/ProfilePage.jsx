import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  fields,
  companySizes,
  formValues,
  profilePatch,
} from './profile-fields.js';
import ProfileDetails, { ApprovalStatus } from './ProfileDetails.jsx';

export default function ProfilePage({ role }) {
  const { client } = useAuth();
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({});
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const saving = useRef(false);
  const path = '/profiles/' + role + '/me';
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setEditing(false);
    client
      .request(path)
      .then(({ profile: value }) => {
        if (active) {
          setProfile(value);
          setDraft(formValues(role, value));
        }
      })
      .catch((error) => {
        if (active) setError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, path, role, reload]);

  async function save(event) {
    event.preventDefault();
    if (saving.current) return;
    const body = profilePatch(role, draft, profile);
    if (!Object.keys(body).length) {
      setSuccess('No changes to save.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    setSuccess('');
    try {
      const { profile: value } = await client.request(path, {
        method: 'PATCH',
        body,
      });
      setProfile(value);
      setDraft(formValues(role, value));
      setEditing(false);
      setSuccess('Profile saved successfully.');
    } catch (error) {
      setError(error);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="workspace-page">
      <p className="eyebrow">
        {role === 'student' ? 'YOUR NEXT STEP' : 'YOUR COMPANY'}
      </p>
      <h1>{role === 'student' ? 'Student profile' : 'Company profile'}</h1>
      <p className="muted">
        Keep your details current. Fields are optional; you can build your
        profile over time.
      </p>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error.message}</p>
          {error.details?.length > 0 && (
            <ul>
              {error.details.map((item, index) => (
                <li key={index}>
                  {item.field}: {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {loading ? (
        <p role="status">Loading profile…</p>
      ) : error && !editing ? (
        <button
          className="compact"
          onClick={() => setReload((value) => value + 1)}
        >
          Retry loading profile
        </button>
      ) : (
        <>
          {role === 'recruiter' && profile && (
            <ApprovalStatus company={profile} />
          )}
          <div className="card">
            {!editing ? (
              <>
                {profile ? (
                  <ProfileDetails role={role} profile={profile} />
                ) : (
                  <p>No profile yet. Add your details to get started.</p>
                )}
                <button
                  className="compact"
                  onClick={() => {
                    setEditing(true);
                    setSuccess('');
                  }}
                >
                  {profile ? 'Edit profile' : 'Create profile'}
                </button>
              </>
            ) : (
              <form onSubmit={save}>
                <h2>{profile ? 'Edit your details' : 'Create your profile'}</h2>
                <fieldset disabled={busy} className="profile-form">
                  <legend className="muted">Profile details</legend>
                  {fields[role].map(([key, label, type, max, upper]) => {
                    const props = {
                      name: key,
                      value: draft[key] ?? '',
                      onChange: (event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        })),
                    };
                    return (
                      <label
                        key={key}
                        className={type === 'textarea' ? 'wide' : ''}
                      >
                        {label}
                        {type === 'textarea' ? (
                          <textarea {...props} maxLength={max} rows={5} />
                        ) : type === 'select' ? (
                          <select {...props}>
                            <option value="">Not specified</option>
                            {companySizes.map((size) => (
                              <option key={size}>{size}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            {...props}
                            type={type === 'skills' ? 'text' : type}
                            {...(type === 'number'
                              ? {
                                  min: max,
                                  max: upper,
                                  step: key === 'cgpa' ? 'any' : 1,
                                }
                              : { maxLength: max })}
                          />
                        )}
                      </label>
                    );
                  })}
                </fieldset>
                <div className="actions">
                  <button disabled={busy}>
                    {busy ? 'Saving…' : 'Save profile'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setDraft(formValues(role, profile));
                      setEditing(false);
                      setError(null);
                      setSuccess('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  );
}
ProfilePage.propTypes = {
  role: PropTypes.oneOf(['student', 'recruiter']).isRequired,
};
