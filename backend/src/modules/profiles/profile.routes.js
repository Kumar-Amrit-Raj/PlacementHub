import { Router } from 'express';
import {
  updateRecruiterProfile,
  ApprovalError,
} from './company-approval.service.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { StudentProfile } from './student-profile.model.js';
import { RecruiterProfile } from './recruiter-profile.model.js';
import {
  studentProfilePatch,
  recruiterProfilePatch,
} from './profile.validation.js';
import { updateOwnProfile } from './profile.service.js';

function ownProfile(profile) {
  if (!profile) return null;
  const value = profile.toJSON();
  delete value.approvalHistory;
  return value;
}

export function createProfileRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  for (const [role, Model, schema] of [
    ['student', StudentProfile, studentProfilePatch],
    ['recruiter', RecruiterProfile, recruiterProfilePatch],
  ]) {
    router.get('/' + role + '/me', authorize(role), async (req, res) => {
      res.json({
        profile: ownProfile(await Model.findOne({ user: req.user.id })),
      });
    });
    router.patch(
      '/' + role + '/me',
      authorize(role),
      validate(schema),
      async (req, res) => {
        try {
          const profile =
            role === 'recruiter'
              ? await updateRecruiterProfile(req.user.id, req.body)
              : await updateOwnProfile(Model, req.user.id, req.body);
          res.json({ profile: ownProfile(profile) });
        } catch (error) {
          if (error instanceof ApprovalError)
            return res.status(error.status).json({ error: error.message });
          throw error;
        }
      },
    );
  }
  return router;
}
