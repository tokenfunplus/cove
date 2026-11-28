export const COVEWEB_APPS_URL = "https://www.hicove.io/apps";

export function coveWebAppURL(publisher: string, app: string, version?: string) {
  const url = new URL(
    COVEWEB_APPS_URL +
      "/" +
      encodeURIComponent(publisher) +
      "/" +
      encodeURIComponent(app),
  );
  if (version) url.searchParams.set("version", version);
  return url.href;
}
