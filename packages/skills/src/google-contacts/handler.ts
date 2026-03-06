import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export class GoogleContactsHandler implements SkillHandler {
  private people;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.people = google.people({ version: "v1", auth });
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "search_contacts":
        this.requireParam(params, "query", actionName);
        return this.searchContacts(params);
      case "create_contact":
        this.requireParam(params, "given_name", actionName);
        return this.createContact(params);
      case "update_contact":
        this.requireParam(params, "resource_name", actionName);
        return this.updateContact(params);
      default:
        throw new Error(`Unknown GoogleContacts action: ${actionName}`);
    }
  }

  private requireParam(
    params: Record<string, unknown>,
    name: string,
    action: string
  ): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`GoogleContacts ${action} failed: ${message}`);
  }

  private async searchContacts(params: Record<string, unknown>) {
    const query = params.query as string;
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 1), 50);

    try {
      const res = await this.people.people.searchContacts({
        query,
        readMask: "names,emailAddresses,phoneNumbers,organizations",
        pageSize: maxResults,
      });

      const contacts = (res.data.results || []).map((result) => {
        const person = result.person || {};
        return {
          resourceName: person.resourceName,
          name: person.names?.[0]?.displayName,
          givenName: person.names?.[0]?.givenName,
          familyName: person.names?.[0]?.familyName,
          email: person.emailAddresses?.[0]?.value,
          phone: person.phoneNumbers?.[0]?.value,
          organization: person.organizations?.[0]?.name,
        };
      });

      return { contacts, count: contacts.length };
    } catch (err) {
      this.wrapApiError("search_contacts", err);
    }
  }

  private async createContact(params: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {
      names: [
        {
          givenName: params.given_name as string,
          familyName: (params.family_name as string) || undefined,
        },
      ],
    };

    if (params.email) {
      requestBody.emailAddresses = [{ value: params.email as string }];
    }
    if (params.phone) {
      requestBody.phoneNumbers = [{ value: params.phone as string }];
    }
    if (params.organization) {
      requestBody.organizations = [{ name: params.organization as string }];
    }

    try {
      const res = await this.people.people.createContact({
        requestBody,
      });

      return {
        created: true,
        resourceName: res.data.resourceName,
        name: res.data.names?.[0]?.displayName,
      };
    } catch (err) {
      this.wrapApiError("create_contact", err);
    }
  }

  private async updateContact(params: Record<string, unknown>) {
    const resourceName = params.resource_name as string;

    try {
      // First get the current contact to obtain etag
      const current = await this.people.people.get({
        resourceName,
        personFields: "names,emailAddresses,phoneNumbers,organizations",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const requestBody: Record<string, any> = {
        etag: current.data.etag,
      };

      const updatePersonFields: string[] = [];

      if (params.given_name !== undefined || params.family_name !== undefined) {
        requestBody.names = [
          {
            givenName: (params.given_name as string) ?? current.data.names?.[0]?.givenName,
            familyName: (params.family_name as string) ?? current.data.names?.[0]?.familyName,
          },
        ];
        updatePersonFields.push("names");
      }

      if (params.email !== undefined) {
        requestBody.emailAddresses = [{ value: params.email as string }];
        updatePersonFields.push("emailAddresses");
      }

      if (params.phone !== undefined) {
        requestBody.phoneNumbers = [{ value: params.phone as string }];
        updatePersonFields.push("phoneNumbers");
      }

      if (params.organization !== undefined) {
        requestBody.organizations = [{ name: params.organization as string }];
        updatePersonFields.push("organizations");
      }

      const res = await this.people.people.updateContact({
        resourceName,
        updatePersonFields: updatePersonFields.join(","),
        requestBody,
      });

      return {
        updated: true,
        resourceName: res.data.resourceName,
        name: res.data.names?.[0]?.displayName,
      };
    } catch (err) {
      this.wrapApiError("update_contact", err);
    }
  }
}
