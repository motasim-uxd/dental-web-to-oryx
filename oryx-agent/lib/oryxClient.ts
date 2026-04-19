import got, { type Got } from "got";
import { CookieJar } from "tough-cookie";

export type OryxRealm = "smilesquadpd" | (string & {});

export type OryxApptType = "Cleaning" | (string & {});

export interface OryxTime {
  hour: number;
  minute: number;
  second?: number;
  millis?: number;
}

export interface OryxDate {
  year: number;
  month: number;
  day: number;
}

export interface BookOnlineApptInput {
  apptType: OryxApptType;
  date: OryxDate;
  start: Required<OryxTime>;
  end: Required<OryxTime>;
  dayOfWeek: number;
  operatoryId: number;
  oralId: number;
  reason: string;
  notes?: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dob: OryxDate;
  email: string;
  phoneNumber: string;
  newOrExisting: "new" | "existing";
}

export interface OryxClientOptions {
  baseUrl?: string;
  realm: OryxRealm;
}

export class OryxClient {
  private readonly baseUrl: string;
  private readonly realm: OryxRealm;
  private readonly jar: CookieJar;
  private readonly http: Got;
  private initialized = false;

  constructor(opts: OryxClientOptions) {
    this.baseUrl = opts.baseUrl ?? "https://mychart.myoryx.com";
    this.realm = opts.realm;
    this.jar = new CookieJar();
    this.http = got.extend({
      prefixUrl: this.baseUrl.replace(/\/+$/, ""),
      cookieJar: this.jar,
      throwHttpErrors: false,
      headers: {
        accept: "application/json, text/plain, */*",
        "x-mychart-realm": this.realm,
      },
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.http
      .get(
        `online-schedule/index.html?realm=${encodeURIComponent(
          this.realm
        )}&univers=com`,
        { headers: { accept: "text/html,*/*" } }
      )
      .text();

    this.initialized = true;
  }

  async getProviders(apptType: OryxApptType) {
    await this.init();
    return this.http
      .get(`office/api/realm/providers/${encodeURIComponent(this.realm)}`, {
        searchParams: { apptType },
      })
      .json<any>();
  }

  async getScheduleForDate(params: {
    apptType: OryxApptType;
    dateISO: string;
    firstAvail?: boolean;
  }) {
    await this.init();
    return this.http
      .get(
        `office/api/online/schedule/${encodeURIComponent(
          this.realm
        )}/0/${params.dateISO}`,
        {
          searchParams: {
            apptType: params.apptType,
            firstAvail: params.firstAvail ? "true" : "false",
          },
        }
      )
      .json<any>();
  }

  async showCreditCard() {
    await this.init();
    return this.http
      .get(`office/api/online/schedule/showCard/${encodeURIComponent(this.realm)}`)
      .json<any>();
  }

  async getPracticeInfo() {
    await this.init();
    return this.http
      .get(`office/api/practice/info/${encodeURIComponent(this.realm)}`)
      .json<any>();
  }

  async getPracticeContactInfo() {
    await this.init();
    return this.http
      .get(`office/api/practice/cinfo/${encodeURIComponent(this.realm)}`)
      .json<any>();
  }

  async bookOnlineAppointment(input: BookOnlineApptInput) {
    await this.init();
    const body = {
      onlineAppt: {
        date: input.date,
        start: input.start,
        end: input.end,
        dayOfWeek: input.dayOfWeek,
        operatoryId: input.operatoryId,
        oralId: input.oralId,
        reason: input.reason,
        onlineApptReason: input.notes ?? "",
        firstName: input.firstName,
        lastName: input.lastName,
        preferredName: input.preferredName ?? input.firstName,
        dob: {
          ...input.dob,
          hour: 0,
          minute: 0,
          second: 0,
          millis: 0,
        },
        email: input.email,
        phoneNumber: input.phoneNumber,
        newOrExisting: input.newOrExisting,
      },
    };

    return this.http
      .post(
        `office/api/online/schedule/appointment/${encodeURIComponent(
          this.realm
        )}`,
        {
          json: body,
          headers: { "content-type": "application/json" },
        }
      )
      .json<any>();
  }
}

