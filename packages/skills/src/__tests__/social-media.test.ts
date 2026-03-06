import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { InstagramHandler } from "../instagram/index.js";
import { FacebookPagesHandler } from "../facebook-pages/index.js";
import { LinkedInHandler } from "../linkedin/index.js";
import { XHandler } from "../x/index.js";

function mockFetchOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ====================================================================
// Instagram
// ====================================================================

describe("InstagramHandler", () => {
  let handler: InstagramHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new InstagramHandler("fake-token");
  });

  describe("get_profile", () => {
    it("returns formatted profile", async () => {
      mockFetchOk({
        id: "ig123",
        username: "testuser",
        name: "Test User",
        biography: "Hello world",
        followers_count: 1000,
        follows_count: 500,
        media_count: 42,
        profile_picture_url: "https://example.com/pic.jpg",
      });

      const result = (await handler.execute("get_profile", {
        ig_user_id: "ig123",
      })) as Record<string, unknown>;

      expect(result.id).toBe("ig123");
      expect(result.username).toBe("testuser");
      expect(result.followersCount).toBe(1000);
      expect(result.mediaCount).toBe(42);
    });

    it("requires ig_user_id parameter", async () => {
      await expect(
        handler.execute("get_profile", {})
      ).rejects.toThrow("Missing required parameter: ig_user_id for get_profile");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "unauthorized");

      await expect(
        handler.execute("get_profile", { ig_user_id: "ig123" })
      ).rejects.toThrow("Instagram get_profile failed: HTTP 401: unauthorized");
    });
  });

  describe("list_posts", () => {
    it("returns formatted post list", async () => {
      mockFetchOk({
        data: [
          {
            id: "post1",
            caption: "Beach day!",
            media_type: "IMAGE",
            media_url: "https://example.com/img.jpg",
            timestamp: "2025-01-15T12:00:00Z",
            like_count: 100,
            comments_count: 10,
          },
        ],
      });

      const result = (await handler.execute("list_posts", {
        ig_user_id: "ig123",
      })) as { posts: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.posts[0].id).toBe("post1");
      expect(result.posts[0].caption).toBe("Beach day!");
      expect(result.posts[0].likeCount).toBe(100);
    });

    it("clamps maxResults to 50", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("list_posts", {
        ig_user_id: "ig123",
        max_results: 999,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50")
      );
    });

    it("clamps maxResults minimum to 1", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("list_posts", {
        ig_user_id: "ig123",
        max_results: -5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=1")
      );
    });

    it("requires ig_user_id parameter", async () => {
      await expect(
        handler.execute("list_posts", {})
      ).rejects.toThrow("Missing required parameter: ig_user_id for list_posts");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(400, "bad request");

      await expect(
        handler.execute("list_posts", { ig_user_id: "ig123" })
      ).rejects.toThrow("Instagram list_posts failed: HTTP 400: bad request");
    });
  });

  describe("create_post", () => {
    it("creates post via two-step container publish", async () => {
      // Step 1: create container
      mockFetchOk({ id: "container123" });
      // Step 2: publish
      mockFetchOk({ id: "published456" });

      const result = (await handler.execute("create_post", {
        ig_user_id: "ig123",
        image_url: "https://example.com/photo.jpg",
        caption: "Great day!",
      })) as { created: boolean; postId: string };

      expect(result.created).toBe(true);
      expect(result.postId).toBe("published456");

      // Verify first call is media container creation
      expect(mockFetch.mock.calls[0][0]).toContain("/media");
      // Verify second call is publish
      expect(mockFetch.mock.calls[1][0]).toContain("/media_publish");
    });

    it("requires ig_user_id parameter", async () => {
      await expect(
        handler.execute("create_post", { image_url: "https://example.com/img.jpg" })
      ).rejects.toThrow("Missing required parameter: ig_user_id for create_post");
    });

    it("requires image_url parameter", async () => {
      await expect(
        handler.execute("create_post", { ig_user_id: "ig123" })
      ).rejects.toThrow("Missing required parameter: image_url for create_post");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(400, "invalid image url");

      await expect(
        handler.execute("create_post", {
          ig_user_id: "ig123",
          image_url: "https://example.com/bad.jpg",
        })
      ).rejects.toThrow("Instagram create_post failed: HTTP 400: invalid image url");
    });
  });

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown Instagram action: nonexistent_action");
  });
});

// ====================================================================
// Facebook Pages
// ====================================================================

describe("FacebookPagesHandler", () => {
  let handler: FacebookPagesHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new FacebookPagesHandler("fake-token");
  });

  describe("list_pages", () => {
    it("returns formatted page list", async () => {
      mockFetchOk({
        data: [
          {
            id: "page1",
            name: "My Business",
            category: "Local Business",
            fan_count: 5000,
            access_token: "page-token",
          },
        ],
      });

      const result = (await handler.execute("list_pages", {})) as {
        pages: Array<Record<string, unknown>>; count: number;
      };

      expect(result.count).toBe(1);
      expect(result.pages[0]).toEqual({
        id: "page1",
        name: "My Business",
        category: "Local Business",
        fanCount: 5000,
      });
      // Should NOT expose page access token
      expect(result.pages[0]).not.toHaveProperty("access_token");
    });

    it("clamps maxResults to 50", async () => {
      mockFetchOk({ data: [] });

      await handler.execute("list_pages", { max_results: 999 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50")
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "unauthorized");

      await expect(
        handler.execute("list_pages", {})
      ).rejects.toThrow("FacebookPages list_pages failed: HTTP 401: unauthorized");
    });
  });

  describe("create_post", () => {
    it("creates post on page", async () => {
      mockFetchOk({ id: "page1_post123" });

      const result = (await handler.execute("create_post", {
        page_id: "page1",
        message: "Hello from our page!",
      })) as { created: boolean; postId: string };

      expect(result.created).toBe(true);
      expect(result.postId).toBe("page1_post123");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("page1/feed"),
        expect.any(Object)
      );
    });

    it("includes link when provided", async () => {
      mockFetchOk({ id: "page1_post456" });

      await handler.execute("create_post", {
        page_id: "page1",
        message: "Check this out",
        link: "https://example.com",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.link).toBe("https://example.com");
    });

    it("requires page_id parameter", async () => {
      await expect(
        handler.execute("create_post", { message: "Hello" })
      ).rejects.toThrow("Missing required parameter: page_id for create_post");
    });

    it("requires message parameter", async () => {
      await expect(
        handler.execute("create_post", { page_id: "page1" })
      ).rejects.toThrow("Missing required parameter: message for create_post");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(403, "page permissions error");

      await expect(
        handler.execute("create_post", {
          page_id: "page1",
          message: "Hello",
        })
      ).rejects.toThrow("FacebookPages create_post failed: HTTP 403: page permissions error");
    });
  });

  describe("get_insights", () => {
    it("returns page insights", async () => {
      mockFetchOk({
        data: [
          {
            name: "page_impressions",
            period: "day",
            values: [{ value: 1234, end_time: "2025-01-15T08:00:00+0000" }],
          },
        ],
      });

      const result = (await handler.execute("get_insights", {
        page_id: "page1",
      })) as { insights: Array<Record<string, unknown>>; pageId: string };

      expect(result.pageId).toBe("page1");
      expect(result.insights).toHaveLength(1);
      expect(result.insights[0].name).toBe("page_impressions");
    });

    it("requires page_id parameter", async () => {
      await expect(
        handler.execute("get_insights", {})
      ).rejects.toThrow("Missing required parameter: page_id for get_insights");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(400, "invalid metric");

      await expect(
        handler.execute("get_insights", { page_id: "page1" })
      ).rejects.toThrow("FacebookPages get_insights failed: HTTP 400: invalid metric");
    });
  });

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown FacebookPages action: nonexistent_action");
  });
});

// ====================================================================
// LinkedIn
// ====================================================================

describe("LinkedInHandler", () => {
  let handler: LinkedInHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new LinkedInHandler("fake-token");
  });

  describe("get_profile", () => {
    it("returns formatted profile", async () => {
      mockFetchOk({
        id: "li123",
        firstName: {
          localized: { en_US: "John" },
          preferredLocale: { language: "en", country: "US" },
        },
        lastName: {
          localized: { en_US: "Doe" },
          preferredLocale: { language: "en", country: "US" },
        },
      });

      const result = (await handler.execute("get_profile", {})) as Record<string, unknown>;

      expect(result.id).toBe("li123");
      expect(result.firstName).toBe("John");
      expect(result.lastName).toBe("Doe");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "invalid token");

      await expect(
        handler.execute("get_profile", {})
      ).rejects.toThrow("LinkedIn get_profile failed: HTTP 401: invalid token");
    });
  });

  describe("create_post", () => {
    it("creates LinkedIn post", async () => {
      // First call: get profile for user URN
      mockFetchOk({ id: "li123" });
      // Second call: create post
      mockFetchOk({ id: "urn:li:share:789" });

      const result = (await handler.execute("create_post", {
        text: "Excited to share this!",
      })) as { created: boolean; postId: string };

      expect(result.created).toBe(true);
      expect(result.postId).toBe("urn:li:share:789");

      // Verify ugcPosts endpoint called
      expect(mockFetch.mock.calls[1][0]).toContain("ugcPosts");
    });

    it("requires text parameter", async () => {
      await expect(
        handler.execute("create_post", {})
      ).rejects.toThrow("Missing required parameter: text for create_post");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(403, "forbidden");

      await expect(
        handler.execute("create_post", { text: "Hello" })
      ).rejects.toThrow("LinkedIn create_post failed: HTTP 403: forbidden");
    });
  });

  describe("list_posts", () => {
    it("returns formatted post list", async () => {
      // First call: get profile
      mockFetchOk({ id: "li123" });
      // Second call: get posts
      mockFetchOk({
        elements: [
          {
            id: "urn:li:share:456",
            created: { time: 1705320000000 },
            specificContent: {
              "com.linkedin.ugc.ShareContent": {
                shareCommentary: { text: "My LinkedIn post" },
              },
            },
            lifecycleState: "PUBLISHED",
          },
        ],
      });

      const result = (await handler.execute("list_posts", {})) as {
        posts: Array<Record<string, unknown>>; count: number;
      };

      expect(result.count).toBe(1);
      expect(result.posts[0].id).toBe("urn:li:share:456");
      expect(result.posts[0].text).toBe("My LinkedIn post");
      expect(result.posts[0].lifecycleState).toBe("PUBLISHED");
    });

    it("clamps maxResults to 50", async () => {
      mockFetchOk({ id: "li123" });
      mockFetchOk({ elements: [] });

      await handler.execute("list_posts", { max_results: 999 });

      expect(mockFetch.mock.calls[1][0]).toContain("count=50");
    });

    it("clamps maxResults minimum to 1", async () => {
      mockFetchOk({ id: "li123" });
      mockFetchOk({ elements: [] });

      await handler.execute("list_posts", { max_results: -5 });

      expect(mockFetch.mock.calls[1][0]).toContain("count=1");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(500, "server error");

      await expect(
        handler.execute("list_posts", {})
      ).rejects.toThrow("LinkedIn list_posts failed: HTTP 500: server error");
    });
  });

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown LinkedIn action: nonexistent_action");
  });
});

// ====================================================================
// X (Twitter)
// ====================================================================

describe("XHandler", () => {
  let handler: XHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new XHandler("fake-token");
  });

  describe("get_profile", () => {
    it("returns formatted profile", async () => {
      mockFetchOk({
        data: {
          id: "x123",
          name: "Test User",
          username: "testuser",
          description: "I tweet things",
          profile_image_url: "https://pbs.twimg.com/pic.jpg",
          public_metrics: {
            followers_count: 10000,
            following_count: 500,
            tweet_count: 5000,
          },
        },
      });

      const result = (await handler.execute("get_profile", {})) as Record<string, unknown>;

      expect(result.id).toBe("x123");
      expect(result.username).toBe("testuser");
      expect(result.followersCount).toBe(10000);
      expect(result.tweetCount).toBe(5000);
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(401, "unauthorized");

      await expect(
        handler.execute("get_profile", {})
      ).rejects.toThrow("X get_profile failed: HTTP 401: unauthorized");
    });
  });

  describe("create_tweet", () => {
    it("creates a tweet", async () => {
      mockFetchOk({
        data: { id: "tweet123", text: "Hello world!" },
      });

      const result = (await handler.execute("create_tweet", {
        text: "Hello world!",
      })) as { created: boolean; tweetId: string; text: string };

      expect(result.created).toBe(true);
      expect(result.tweetId).toBe("tweet123");
      expect(result.text).toBe("Hello world!");
    });

    it("creates a reply tweet", async () => {
      mockFetchOk({
        data: { id: "tweet456", text: "Great point!" },
      });

      await handler.execute("create_tweet", {
        text: "Great point!",
        reply_to: "tweet789",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reply).toEqual({ in_reply_to_tweet_id: "tweet789" });
    });

    it("requires text parameter", async () => {
      await expect(
        handler.execute("create_tweet", {})
      ).rejects.toThrow("Missing required parameter: text for create_tweet");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(403, "duplicate tweet");

      await expect(
        handler.execute("create_tweet", { text: "Hello" })
      ).rejects.toThrow("X create_tweet failed: HTTP 403: duplicate tweet");
    });
  });

  describe("list_tweets", () => {
    it("returns formatted tweet list", async () => {
      // First call: get user ID
      mockFetchOk({ data: { id: "x123" } });
      // Second call: get tweets
      mockFetchOk({
        data: [
          {
            id: "tweet1",
            text: "My first tweet",
            created_at: "2025-01-15T12:00:00.000Z",
            public_metrics: {
              retweet_count: 5,
              reply_count: 2,
              like_count: 20,
              quote_count: 1,
            },
          },
        ],
      });

      const result = (await handler.execute("list_tweets", {})) as {
        tweets: Array<Record<string, unknown>>; count: number;
      };

      expect(result.count).toBe(1);
      expect(result.tweets[0].id).toBe("tweet1");
      expect(result.tweets[0].text).toBe("My first tweet");
      expect(result.tweets[0].likeCount).toBe(20);
      expect(result.tweets[0].retweetCount).toBe(5);
    });

    it("clamps maxResults minimum to 5 (X API minimum)", async () => {
      mockFetchOk({ data: { id: "x123" } });
      mockFetchOk({ data: [] });

      await handler.execute("list_tweets", { max_results: 1 });

      expect(mockFetch.mock.calls[1][0]).toContain("max_results=5");
    });

    it("clamps maxResults to 100", async () => {
      mockFetchOk({ data: { id: "x123" } });
      mockFetchOk({ data: [] });

      await handler.execute("list_tweets", { max_results: 999 });

      expect(mockFetch.mock.calls[1][0]).toContain("max_results=100");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFetchError(429, "rate limited");

      await expect(
        handler.execute("list_tweets", {})
      ).rejects.toThrow("X list_tweets failed: HTTP 429: rate limited");
    });
  });

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown X action: nonexistent_action");
  });
});
