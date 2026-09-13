import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import App from '../../app/App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { createAuthClient } from '../../lib/api.js';
import { draftValues, payload } from './opportunity-utils.js';

const company = { approvalStatus: 'approved', profileVersion: 2 };
const item = {
  _id: 'one',
  title: 'Developer',
  description: 'Build web tools',
  jobType: 'full-time',
  location: 'Remote',
  compensation: 'INR 10 lakh annually',
  deadline: '2099-06-30T12:00:00.000Z',
  minimumCgpa: 7,
  allowedBranches: ['CSE'],
  graduationYear: 2099,
  status: 'draft',
  approvedCompanyVersion: 2,
  company: { companyName: 'Example Labs' },
};
const response = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
function setup(role, path, handler, profile = company) {
  const calls = vi.fn(async (url, options) => {
    if (url.endsWith('/auth/refresh')) return response({ accessToken: 'test' });
    if (url.endsWith('/auth/me'))
      return response({ user: { id: 'u', name: 'Tester', role } });
    if (url.endsWith('/profiles/recruiter/me')) return response({ profile });
    return handler(url.replace('/api/v1', ''), options);
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={createAuthClient({ fetcher: calls })}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { actor: userEvent.setup(), calls };
}
describe('opportunities', () => {
  it('lists student opportunities, paginates, and loads eligibility details', async () => {
    const { actor } = setup(
      'student',
      '/student/opportunities',
      async (url) => {
        if (url === '/opportunities/one')
          return response({ opportunity: item });
        if (url.includes('after='))
          return response({
            opportunities: [{ ...item, _id: 'two', title: 'Intern' }],
            nextCursor: null,
          });
        return response({ opportunities: [item], nextCursor: 'one' });
      },
    );
    await screen.findByText('Developer');
    await actor.click(
      screen.getByRole('button', { name: 'Load more opportunities' }),
    );
    await screen.findByText('Intern');
    await actor.click(
      screen.getByRole('link', { name: /View opportunity.*Developer/ }),
    );
    expect(await screen.findByText('Build web tools')).toBeVisible();
    expect(screen.getByText('CSE')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Apply/ }),
    ).not.toBeInTheDocument();
  });
  it('shows loading, error retry, and an empty list', async () => {
    let release;
    let count = 0;
    const { actor } = setup('student', '/student/opportunities', () =>
      ++count === 1
        ? new Promise((resolve) => {
            release = () => resolve(response({ error: 'Unavailable' }, 503));
          })
        : response({ opportunities: [], nextCursor: null }),
    );
    await screen.findByText('Loading opportunities…');
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    await actor.click(
      screen.getByRole('button', { name: 'Refresh opportunities' }),
    );
    expect(await screen.findByText('No current opportunities')).toBeVisible();
  });
  it('handles unavailable detail without exposing stale contents', async () => {
    setup('student', '/student/opportunities/one', () =>
      response({ error: 'Opportunity not found' }, 404),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer available',
    );
    expect(screen.queryByText('Build web tools')).not.toBeInTheDocument();
  });
  it.each([
    ['student', '/recruiter/opportunities'],
    ['student', '/recruiter/opportunities/new'],
    ['student', '/recruiter/opportunities/one/edit'],
    ['recruiter', '/student/opportunities'],
    ['admin', '/student/opportunities/one'],
  ])('denies %s access to %s', async (role, path) => {
    const handler = vi.fn();
    setup(role, path, handler);
    await screen.findByRole('heading', { name: 'Access restricted' });
    expect(handler).not.toHaveBeenCalled();
  });
  it('creates a draft with typed eligibility and a UTC deadline, then shows success', async () => {
    let body;
    const { actor } = setup(
      'recruiter',
      '/recruiter/opportunities/new',
      async (url, options) => {
        if (options.method === 'POST') {
          body = JSON.parse(options.body);
          return response({ opportunity: { ...item, ...body } }, 201);
        }
        return response({ opportunity: { ...item, ...body } });
      },
    );
    await screen.findByLabelText('Title');
    await actor.type(screen.getByLabelText('Title'), 'Developer');
    await actor.type(screen.getByLabelText('Description'), 'Build web tools');
    await actor.type(screen.getByLabelText('Location'), 'Remote');
    await actor.type(screen.getByLabelText('Compensation'), 'Paid monthly');
    fireEvent.change(screen.getByLabelText('Deadline (local time)'), {
      target: { value: '2099-06-30T12:00' },
    });
    await actor.type(screen.getByLabelText('Minimum CGPA'), '7.5');
    await actor.type(
      screen.getByLabelText('Allowed branches (comma-separated)'),
      'CSE, ECE',
    );
    await actor.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('heading', { name: 'Edit opportunity' });
    expect(body.minimumCgpa).toBe(7.5);
    expect(body.allowedBranches).toEqual(['CSE', 'ECE']);
    expect(body.graduationYear).toBeNull();
    expect(body.deadline).toBe(new Date('2099-06-30T12:00').toISOString());
    expect(body.status).toBeUndefined();
    expect(body.company).toBeUndefined();
    expect(await screen.findByText('Draft saved successfully.')).toBeVisible();
  });
  it('sends only changed fields and saves published edits as a draft', async () => {
    let body;
    const { actor } = setup(
      'recruiter',
      '/recruiter/opportunities/one/edit',
      async (url, options) => {
        if (options.method === 'PATCH') {
          body = JSON.parse(options.body);
          return response({ opportunity: { ...item, ...body } });
        }
        return response({ opportunity: { ...item, status: 'published' } });
      },
    );
    await screen.findByLabelText('Minimum CGPA');
    await actor.clear(screen.getByLabelText('Minimum CGPA'));
    expect(
      screen.getByRole('button', { name: 'Unpublish opportunity' }),
    ).toBeDisabled();
    await actor.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved successfully.');
    expect(body).toEqual({ minimumCgpa: null });
    expect(screen.getByText('draft', { exact: true })).toBeVisible();
  });
  it('publishes and unpublishes through separate empty-body controls', async () => {
    let current = item;
    const { actor } = setup(
      'recruiter',
      '/recruiter/opportunities/one/edit',
      async (url, options) => {
        if (options.method === 'POST') {
          expect(JSON.parse(options.body)).toEqual({});
          current = {
            ...item,
            status: url.endsWith('/unpublish') ? 'draft' : 'published',
          };
        }
        return response({ opportunity: current });
      },
    );
    await screen.findByRole('button', { name: 'Publish opportunity' });
    await actor.click(
      screen.getByRole('button', { name: 'Publish opportunity' }),
    );
    await screen.findByText('Opportunity published successfully.');
    await actor.click(
      screen.getByRole('button', { name: 'Unpublish opportunity' }),
    );
    expect(
      await screen.findByText('Opportunity unpublished successfully.'),
    ).toBeVisible();
  });
  it('blocks controls after a conflict until explicitly reloaded', async () => {
    const { actor } = setup(
      'recruiter',
      '/recruiter/opportunities/one/edit',
      async (url, options) =>
        options.method === 'POST'
          ? response({ error: 'Opportunity changed' }, 409)
          : response({ opportunity: item }),
    );
    await screen.findByRole('button', { name: 'Publish opportunity' });
    await actor.click(
      screen.getByRole('button', { name: 'Publish opportunity' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Opportunity changed',
    );
    expect(
      screen.getByRole('button', { name: 'Publish opportunity' }),
    ).toBeDisabled();
    await actor.click(
      screen.getByRole('button', { name: 'Reload opportunity' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Publish opportunity' }),
      ).toBeEnabled(),
    );
  });
  it('retains form values and displays server field validation errors', async () => {
    const { actor } = setup(
      'recruiter',
      '/recruiter/opportunities/one/edit',
      async (url, options) =>
        options.method === 'PATCH'
          ? response(
              {
                error: 'Validation failed',
                details: [
                  {
                    field: 'allowedBranches',
                    message: 'Branches must be unique',
                  },
                ],
              },
              400,
            )
          : response({ opportunity: item }),
    );
    await screen.findByLabelText('Allowed branches (comma-separated)');
    await actor.type(
      screen.getByLabelText('Allowed branches (comma-separated)'),
      ', cse',
    );
    await actor.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Branches must be unique',
    );
    expect(
      screen.getByLabelText('Allowed branches (comma-separated)'),
    ).toHaveValue('CSE, cse');
  });
  it('blocks publication for pending companies and marks expired records', async () => {
    setup(
      'recruiter',
      '/recruiter/opportunities/one/edit',
      () =>
        response({
          opportunity: { ...item, deadline: '2000-01-01T00:00:00Z' },
        }),
      { ...company, approvalStatus: 'pending' },
    );
    await screen.findByText('Expired', { exact: true });
    expect(
      screen.getByRole('button', { name: 'Publish opportunity' }),
    ).toBeDisabled();
    expect(screen.getByText(/Company approval is required/)).toBeVisible();
  });
  it('shows hidden published records and offers republication after company reapproval', async () => {
    setup('recruiter', '/recruiter/opportunities/one/edit', () =>
      response({
        opportunity: {
          ...item,
          status: 'published',
          approvedCompanyVersion: 1,
        },
      }),
    );
    await screen.findByText(/Hidden — company/);
    expect(
      screen.getByRole('button', { name: 'Republish opportunity' }),
    ).toBeEnabled();
  });
  it('directs recruiters without company profiles to profile setup', async () => {
    setup('recruiter', '/recruiter/opportunities/new', vi.fn(), null);
    expect(
      await screen.findByText(/before adding opportunities/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Save draft' }),
    ).not.toBeInTheDocument();
  });
  it('does not reserialize an unchanged deadline when patching another field', () => {
    const original = { ...item, deadline: '2099-06-30T12:00:43.123Z' };
    const draft = draftValues(original);
    draft.title = 'New title';
    expect(payload(draft, original)).toEqual({ title: 'New title' });
  });
});
