import { describe, expect, it } from 'vitest';
import { FEEDBACK_RULES, FEEDBACK_STORAGE_KEYS } from '#lib/config/feedback.ts';
import { createServerObservationRepository } from '#lib/server/repositories/observations.ts';
import type { InfrastructureFeedback, NewObservation } from '#lib/types/feedback.ts';
import {
	decodeFeedback,
	decodeObservations,
	summarizeFeedback,
	validateFeedback,
	validateObservation
} from './feedback.ts';
import { createLocalObservationRepository } from './repositories/local.ts';
import { createFeedbackRepository, createObservationRepository } from './repositories/memory.ts';

const input: NewObservation = {
	type: 'flooding',
	position: [73.51, 4.175],
	description: '  Ankle-deep water after rain  '
};

class MemoryStorage implements Storage {
	#data = new Map<string, string>();
	get length() {
		return this.#data.size;
	}
	clear() {
		this.#data.clear();
	}
	getItem(k: string) {
		return this.#data.get(k) ?? null;
	}
	key(i: number) {
		return [...this.#data.keys()][i] ?? null;
	}
	removeItem(k: string) {
		this.#data.delete(k);
	}
	setItem(k: string, v: string) {
		this.#data.set(k, v);
	}
}

describe('validation', () => {
	it('accepts and trims a valid observation', () => {
		const r = validateObservation(input);
		expect(r.ok && r.value.description).toBe('Ankle-deep water after rain');
	});

	it('rejects missing location, bad type and bad lengths', () => {
		expect(validateObservation({ ...input, position: [500, 4] }).ok).toBe(false);
		expect(validateObservation({ ...input, type: 'aliens' as never }).ok).toBe(false);
		expect(validateObservation({ ...input, description: ' a ' }).ok).toBe(false);
		const long = 'x'.repeat(FEEDBACK_RULES.descriptionMaxLength + 1);
		expect(validateObservation({ ...input, description: long }).ok).toBe(false);
	});

	it('requires text only for comments', () => {
		expect(validateFeedback({ featureId: 'f', kind: 'support', text: '' }).ok).toBe(true);
		expect(validateFeedback({ featureId: 'f', kind: 'comment', text: '' }).ok).toBe(false);
		expect(validateFeedback({ featureId: '', kind: 'support', text: '' }).ok).toBe(false);
	});
});

describe('stored data decoding', () => {
	it('drops malformed records instead of failing', () => {
		expect(decodeObservations('nope')).toEqual([]);
		const good = { id: 'a', createdAt: 't', ...input };
		expect(decodeObservations([good, { id: 'b' }, null])).toEqual([good]);
		expect(
			decodeFeedback([{ id: 'x', featureId: 'f', kind: 'vote', text: '', createdAt: 't' }])
		).toEqual([]);
	});
});

describe('summarizeFeedback', () => {
	const fb = (kind: InfrastructureFeedback['kind']): InfrastructureFeedback => ({
		id: kind,
		featureId: 'f',
		kind,
		text: '',
		createdAt: 't'
	});

	it('reports support share from support and concern only', () => {
		const s = summarizeFeedback([
			...Array.from({ length: 5 }, () => fb('support')),
			fb('concern'),
			fb('concern'),
			fb('comment')
		]);
		expect(s).toEqual({ support: 5, concern: 2, comment: 1, supportShare: 5 / 7 });
		expect(summarizeFeedback([fb('comment')]).supportShare).toBeNull();
	});
});

describe('repositories', () => {
	let n = 0;
	const deps = { newId: () => `id-${++n}`, now: () => '2026-10-09T00:00:00.000Z' };

	it('adds, lists and removes observations', async () => {
		const repo = createObservationRepository([], deps);
		const a = await repo.add(input);
		expect(a).toMatchObject({ type: 'flooding', createdAt: deps.now() });
		expect(await repo.list()).toHaveLength(1);
		await repo.remove(a.id);
		expect(await repo.list()).toHaveLength(0);
	});

	it('persists to browser storage and reloads from it', async () => {
		const storage = new MemoryStorage();
		await createLocalObservationRepository(storage).add(input);
		expect(JSON.parse(storage.getItem(FEEDBACK_STORAGE_KEYS.observations)!)).toHaveLength(1);
		expect(await createLocalObservationRepository(storage).list()).toHaveLength(1);
	});

	it('survives missing or corrupt storage', async () => {
		const storage = new MemoryStorage();
		storage.setItem(FEEDBACK_STORAGE_KEYS.observations, '{broken');
		expect(await createLocalObservationRepository(storage).list()).toEqual([]);
		const offline = createLocalObservationRepository(null);
		await offline.add(input);
		expect(await offline.list()).toHaveLength(1);
	});

	it('keeps feedback separate per facility', async () => {
		const repo = createFeedbackRepository([], deps);
		await repo.add({ featureId: 'a', kind: 'support', text: '' });
		await repo.add({ featureId: 'b', kind: 'concern', text: '' });
		expect((await repo.list()).map((f) => f.featureId)).toEqual(['a', 'b']);
	});

	it('server adapter validates before storing', async () => {
		const repo = createServerObservationRepository();
		await expect(repo.add({ ...input, description: '' })).rejects.toThrow();
		await expect(repo.add(input)).resolves.toMatchObject({ type: 'flooding' });
	});
});
