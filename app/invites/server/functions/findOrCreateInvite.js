import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

import { hasPermission } from '../../../authorization';
import { Notifications } from '../../../notifications';
import { Invites, Subscriptions } from '../../../models';
import { settings } from '../../../settings';

function getInviteUrl(invite) {
	const { rid, _id } = invite;

	const useDirectLink = settings.get('Accounts_Registration_InviteUrlType') === 'direct';
	// Remove the last dash if present
	const siteUrl = settings.get('Site_Url').replace(/\/$/g, '');

	if (useDirectLink) {
		return `${ siteUrl }/invite/${ _id }`;
	}

	// Remove the protocol
	const host = siteUrl.replace(/https?\:\/\//i, '');
	const url = `https://go.rocket.chat/?host=${ host }&rid=${ rid }&path=invite/${ _id }`;

	return url;
}

const possibleDays = [0, 1, 7, 15, 30];
const possibleUses = [0, 1, 5, 10, 25, 50, 100];

export const findOrCreateInvite = (userId, invite) => {
	if (!userId || !invite) {
		return false;
	}

	if (!hasPermission(userId, 'create-invite-links')) {
		throw new Meteor.Error('not_authorized');
	}

	if (!invite.rid) {
		throw new Meteor.Error('error-the-field-is-required', 'The field rid is required', { method: 'findOrCreateInvite', field: 'rid' });
	}

	const subscription = Subscriptions.findOneByRoomIdAndUserId(invite.rid, userId, { fields: { _id: 1 } });
	if (!subscription) {
		throw new Meteor.Error('error-invalid-room', 'The rid field is invalid', { method: 'findOrCreateInvite', field: 'rid' });
	}

	let { days, maxUses } = invite;

	if (!possibleDays.includes(days)) {
		days = 1;
	}

	if (!possibleUses.includes(maxUses)) {
		maxUses = 0;
	}

	// Before anything, let's check if there's an existing invite with the same settings for the same channel and user and that has not yet expired.
	const existing = Invites.findOneByUserRoomMaxUsesAndExpiration(invite.rid, userId, maxUses, days);

	// If an existing invite was found, return it's _id instead of creating a new one.
	if (existing) {
		return {
			_id: existing._id,
			url: getInviteUrl(existing),
			days: existing.days,
			maxUses: existing.maxUses,
			uses: existing.uses,
			expires: existing.expires,
		};
	}

	const _id = Random.id(6);

	// insert invite
	const now = new Date();
	let expires = null;
	if (days > 0) {
		expires = new Date(now);
		expires.setDate(expires.getDate() + days);
	}

	const createInvite = {
		_id,
		days,
		maxUses,
		rid: invite.rid,
		userId,
		createdAt: now,
		expires,
		uses: 0,
	};

	Invites.create(createInvite);

	Notifications.notifyUser(userId, 'updateInvites', { invite: createInvite });
	return {
		_id,
		url: getInviteUrl(createInvite),
		days,
		maxUses,
		uses: 0,
		expires,
	};
};