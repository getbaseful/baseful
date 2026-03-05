/**
 * Simple authenticated fetch wrapper
 */
export async function authFetch(
    url: string,
    token: string | null,
    options: RequestInit = {},
    onUnauthorized?: () => void
) {
    const headers = {
        ...options.headers,
    } as Record<string, string>;

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    if (response.status === 401 && onUnauthorized) {
        onUnauthorized();
    }

    return response;
}
