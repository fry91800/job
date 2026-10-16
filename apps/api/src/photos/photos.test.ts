import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import sharp from "sharp";
import { emptyResumeContent, type GeneratedResumeDetail, type MeResponse, type Photo, type PhotoListResponse } from "@job/shared";
import { config } from "../config";
import { deleteFile } from "../lib/storage";
import { prisma, seedOfferId, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

// A 2000×1500 JPEG carrying EXIF metadata.
const jpegWithExif = () =>
  sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#3366cc" } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret", Artist: "someone" } })
    .toBuffer();

async function send(client: TestClient, method: string, path: string, body?: Buffer) {
  const response = await fetch(new URL(path, server.baseUrl), {
    method,
    headers: { "Content-Type": "application/octet-stream", ...(client.session && { Cookie: `session=${client.session}` }) },
    body: body && new Uint8Array(body),
  });
  const setCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("session="));
  if (setCookie) client.session = /^session=([^;]*)/.exec(setCookie)![1];
  return response;
}

async function upload(client: TestClient, image: Buffer, name?: string) {
  const response = await send(client, "POST", `/api/photos${name ? `?name=${encodeURIComponent(name)}` : ""}`, image);
  return { status: response.status, body: await response.json() };
}

describe("photos (R6)", () => {
  test("upload strips metadata, resizes, and selects the first photo", async () => {
    const client = server.client();
    const { status, body } = await upload(client, await jpegWithExif());
    assert.equal(status, 201);
    assert.equal(body.name, "Photo 1");
    assert.equal(body.isSelected, true);

    const file = await send(client, "GET", `/api/photos/${body.id}/file`);
    assert.equal(file.headers.get("content-type"), "image/webp");
    const metadata = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
    assert.equal(metadata.width, 1000);
    assert.equal(metadata.height, 750);
    assert.equal(metadata.exif, undefined);

    const second = await upload(client, await jpegWithExif(), "Portrait");
    assert.equal(second.body.name, "Portrait");
    assert.equal(second.body.isSelected, false);
  });

  test("small images are not enlarged; PNG and WEBP are accepted", async () => {
    const client = server.client();
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#fff" } }).png().toBuffer();
    const { body } = await upload(client, png);
    const file = await send(client, "GET", `/api/photos/${body.id}/file`);
    assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width, 300);
    const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).webp().toBuffer();
    assert.equal((await upload(client, webp)).status, 201);
  });

  test("other files are refused", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer();
    assert.equal((await upload(server.client(), gif)).status, 415);
    assert.equal((await upload(server.client(), Buffer.from("%PDF-1.4"))).status, 415);
    assert.equal((await upload(server.client(), Buffer.alloc(0))).status, 400);
  });

  test("rename, select, no photo, delete", async () => {
    const client = server.client();
    const first = (await upload(client, await jpegWithExif())).body as Photo;
    const second = (await upload(client, await jpegWithExif())).body as Photo;
    const selected = async () => (await client.get<PhotoListResponse>("/api/photos")).body.results.filter((photo) => photo.isSelected).map((photo) => photo.id);

    assert.equal((await client.patch<Photo>(`/api/photos/${first.id}`, { name: "Pro" })).body.name, "Pro");
    assert.equal((await client.patch(`/api/photos/${first.id}`, { name: "" })).status, 400);

    await client.post(`/api/photos/${second.id}/select`);
    assert.deepEqual(await selected(), [second.id]);
    assert.equal((await client.delete("/api/photos/selection")).status, 204);
    assert.deepEqual(await selected(), []);

    await client.post(`/api/photos/${first.id}/select`);
    assert.equal((await client.delete(`/api/photos/${first.id}`)).status, 204);
    assert.deepEqual(await selected(), []);
    assert.deepEqual((await client.get<PhotoListResponse>("/api/photos")).body.results.map((photo) => photo.id), [second.id]);
  });

  test("photos are private", async () => {
    const owner = server.client();
    const photo = (await upload(owner, await jpegWithExif())).body as Photo;
    assert.equal((await send(server.client(), "GET", `/api/photos/${photo.id}/file`)).status, 401);
    const other = server.client();
    await other.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    assert.equal((await send(other, "GET", `/api/photos/${photo.id}/file`)).status, 404);
    assert.equal((await other.post(`/api/photos/${photo.id}/select`)).status, 404);
    assert.equal((await other.delete(`/api/photos/${photo.id}`)).status, 404);
  });

  test("guests can keep at most the configured number of photos", async () => {
    const client = server.client();
    const image = await jpegWithExif();
    for (let i = 0; i < config.limits.photos.guest; i++) await upload(client, image);
    assert.equal((await upload(client, image)).status, 429);
  });
});

describe("photos in generated resumes", () => {
  test("rendered when the template supports it, until the file is purged", async () => {
    const client = server.client();
    await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    const photo = (await upload(client, await jpegWithExif())).body as Photo;
    await client.post("/api/resumes", { language: "fr", content: emptyResumeContent("Camille Martin") });
    const generated = (await client.post<GeneratedResumeDetail>("/api/generated-resumes", { offerId: seedOfferId("edge-brunoy-fullstack"), modifierEnabled: false })).body;
    assert.equal(generated.photoId, photo.id, "the selected photo, the default template supports photos");

    const html = async () => (await send(client, "GET", `/api/generated-resumes/${generated.id}/html`)).text();
    assert.match(await html(), /<img class="photo" src="data:image\/webp;base64,/);

    // Soft-deleted photos still render (R6).
    await client.delete(`/api/photos/${photo.id}`);
    assert.match(await html(), /data:image\/webp/);

    // A template without photo support ignores it.
    const modern = await prisma.template.findFirstOrThrow({ where: { rendererKey: "modern" } });
    await client.patch(`/api/generated-resumes/${generated.id}`, { templateId: modern.id });
    assert.doesNotMatch(await html(), /data:image/);
    await client.patch(`/api/generated-resumes/${generated.id}`, { templateId: 1 });

    // Once the file is gone, the resume renders without a photo.
    const row = await prisma.userPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    await deleteFile(row.storageKey);
    assert.doesNotMatch(await html(), /data:image/);
  });

  test("the photo can be changed or removed per generated resume", async () => {
    const client = server.client();
    await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    await client.post("/api/resumes", { language: "fr", content: emptyResumeContent("Camille Martin") });
    const generated = (await client.post<GeneratedResumeDetail>("/api/generated-resumes", { offerId: seedOfferId("edge-brunoy-fullstack"), modifierEnabled: false })).body;
    assert.equal(generated.photoId, null);

    const photo = (await upload(client, await jpegWithExif())).body as Photo;
    const html = async () => (await send(client, "GET", `/api/generated-resumes/${generated.id}/html`)).text();
    const withPhoto = await client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`, { photoId: photo.id });
    assert.equal(withPhoto.body.photoId, photo.id);
    assert.match(await html(), /data:image/);
    const without = await client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`, { photoId: null });
    assert.equal(without.body.photoId, null);
    assert.notEqual(without.body.updatedAt, withPhoto.body.updatedAt, "the preview address changes, so it reloads");
    assert.doesNotMatch(await html(), /data:image/);

    const me = (await client.get<MeResponse>("/api/auth/me")).body.user!;
    const foreign = await prisma.userPhoto.findFirst({ where: { userId: { not: me.id } } });
    if (foreign) {
      assert.equal((await client.patch(`/api/generated-resumes/${generated.id}`, { photoId: foreign.id })).status, 404);
    }
  });
});
