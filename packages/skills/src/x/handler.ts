import type { SkillHandler } from "@babji/agent";

const X_API_BASE = "https://api.x.com/2";

export class XHandler implements SkillHandler {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "get_profile":
        return this.getProfile();
      case "create_tweet":
        this.requireParam(params, "text", actionName);
        return this.createTweet(params);
      case "list_tweets":
        return this.listTweets(params);
      default:
        throw new Error(`Unknown X action: ${actionName}`);
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

  private validateId(value: string, name: string): void {
    if (!/^[\w:.-]+$/.test(value)) {
      throw new Error(`Invalid ${name}: contains disallowed characters`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`X ${action} failed: ${message}`);
  }

  private async apiGet(url: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  private async apiPost(url: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(errorBody);
        errorMsg = parsed.error?.message || parsed.error_description || `HTTP ${res.status}`;
      } catch {
        errorMsg = `HTTP ${res.status}`;
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  private async getProfile() {
    try {
      const data = await this.apiGet(
        `${X_API_BASE}/users/me?user.fields=id,name,username,description,public_metrics,profile_image_url`
      ) as { data?: {
        id?: string; name?: string; username?: string; description?: string;
        profile_image_url?: string;
        public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
      } };

      const user = data.data;
      return {
        id: user?.id,
        name: user?.name,
        username: user?.username,
        description: user?.description,
        profileImageUrl: user?.profile_image_url,
        followersCount: user?.public_metrics?.followers_count,
        followingCount: user?.public_metrics?.following_count,
        tweetCount: user?.public_metrics?.tweet_count,
      };
    } catch (err) {
      this.wrapApiError("get_profile", err);
    }
  }

  private async createTweet(params: Record<string, unknown>) {
    const text = params.text as string;
    if (text.length > 280) {
      throw new Error("Tweet text exceeds 280 character limit");
    }
    const replyTo = params.reply_to as string | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = { text };
    if (replyTo) {
      this.validateId(replyTo, "reply_to");
      body.reply = { in_reply_to_tweet_id: replyTo };
    }

    try {
      const data = await this.apiPost(
        `${X_API_BASE}/tweets`,
        body
      ) as { data?: { id?: string; text?: string } };

      return {
        created: true,
        tweetId: data.data?.id,
        text: data.data?.text,
      };
    } catch (err) {
      this.wrapApiError("create_tweet", err);
    }
  }

  private async listTweets(params: Record<string, unknown>) {
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 5), 100);

    try {
      // First get user ID
      const me = await this.apiGet(`${X_API_BASE}/users/me`) as { data?: { id?: string } };
      const userId = me.data?.id;

      if (!userId) {
        throw new Error("Could not determine user ID");
      }
      this.validateId(userId, "user_id");

      const data = await this.apiGet(
        `${X_API_BASE}/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=id,text,created_at,public_metrics`
      ) as { data?: Array<{
        id?: string; text?: string; created_at?: string;
        public_metrics?: { retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number };
      }> };

      const tweets = (data.data || []).map((tweet) => ({
        id: tweet.id,
        text: tweet.text,
        createdAt: tweet.created_at,
        retweetCount: tweet.public_metrics?.retweet_count,
        replyCount: tweet.public_metrics?.reply_count,
        likeCount: tweet.public_metrics?.like_count,
        quoteCount: tweet.public_metrics?.quote_count,
      }));

      return { tweets, count: tweets.length };
    } catch (err) {
      this.wrapApiError("list_tweets", err);
    }
  }
}
