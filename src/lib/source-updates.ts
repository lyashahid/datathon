export interface UpdateSource {
	id: string;
	title: string;
	url: string;
}
export interface SourceReceipt {
	id: string;
	status: string;
	latest_published_month?: string;
	http_status?: number;
	sha256?: string;
	bytes: number;
	retrieved_at: string;
	qualification?: string;
}
export interface SourceCheck {
	checked_at: string;
	items: SourceReceipt[];
}
export interface ScheduleReview {
	services: number;
	islands: number;
	assumed_runtimes: number;
	replaces_service_ids: string[];
}
export interface ScheduleSnapshot {
	id: string;
	title: string;
	accepted: boolean;
	review: ScheduleReview;
	review_note?: string;
}
export interface StagedSchedule {
	id: string;
	accepted: boolean;
	review: ScheduleReview;
	snapshot: { title: string };
	qualification: string;
}
export interface TimedService {
	id: string;
	name: string;
	from_island_id: string;
	to_island_id: string;
	from_name: string;
	to_name: string;
	from_terminal: string;
	to_terminal: string;
	departure: string;
	arrival?: string;
	runtime_minutes?: number;
	effective_from: string;
	effective_until: string;
	timing_basis: string;
	source: { url: string };
}
export interface DepartureCalendar {
	id: string;
	sourceId: string;
	route: string;
	effectiveFrom?: string;
	limitations: string[];
	dayTypes: {
		label: string;
		noScheduledService?: boolean;
		departuresFromMale?: string[];
		departuresFromIsland?: string[];
		frequencyWindows?: { start: string; end: string; headwayMinutes: number }[];
		noServiceWindows?: { start: string; end: string; reason: string }[];
	}[];
}
export interface ScheduleCatalogue {
	services: TimedService[];
	snapshots: ScheduleSnapshot[];
	sources: UpdateSource[];
	published_calendars: DepartureCalendar[];
}
export interface UpdateStatus {
	sources: UpdateSource[];
	latest_check?: SourceCheck | null;
	schedules: ScheduleCatalogue;
}
export interface NationalItinerary {
	status: string;
	arrival_at: string;
	qualification: string;
	legs: (TimedService & { departure_at: string; arrival_at: string })[];
}
