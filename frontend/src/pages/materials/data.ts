import { api, ApiError } from "$lib/api/client";
import { type UploadPublished, type UploadTicket } from "$lib/files/types";
import { encode, publisher, urlId, type Content, type Page } from "../questions/data";

export type MaterialVersion = {
    version: number; size: number; mime: string; uploadedBy: string; createdAt: number;
    previewKind: "pdf" | "image" | null; previewUrl: string | null; downloadUrl: string;
};
export type CourseContent = Content & { latestVersion?: MaterialVersion | null };
export type Material = Content & {
    kind: "material"; title: string; latestVersion: MaterialVersion | null; selectedVersion: MaterialVersion | null;
    versions: Page<MaterialVersion>;
    permissions: { canEdit: boolean; canUploadVersion: boolean; canDeleteVersion: boolean; canManage: boolean; requiresLoginForFile: boolean };
};
export type MaterialPolicy = { maxBytes: number; mimeTypes: string[]; filesPerVersion: 1; fileAccessRequiresLogin: true };
export type PublishedMaterial = { materialId: string; version: number };
export const materialHref = (id: string) => `/materials/${encode(urlId(id))}`;
export const materialPath = (id: string) => `/api/materials/${encode(urlId(id))}`;
export function selectedNumber(value: string | null): number | undefined {
    if (value === null) return undefined;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ApiError(404, "FILE_VERSION_UNAVAILABLE", "版本不可用");
    return Number(value);
}
export const getMaterial = (id: string, version?: number, signal?: AbortSignal) =>
    api.get<Material>(`${materialPath(id)}${version === undefined ? "" : `?version=${version}`}`, { signal });

/** One attempt keeps its draft and key, even when the publish response was lost. */
export function uploadRequest(draft: object, viewerId: string) {
    const request = publisher();
    let uploadId: string | undefined;
    return {
        async prepare(file: { size: number; type: string }, signal: AbortSignal): Promise<UploadTicket | UploadPublished<PublishedMaterial>> {
            const response = await request.post<(UploadTicket & { status: "pending" }) | (UploadPublished<PublishedMaterial> & { uploadId: string })>(
                "/api/material-uploads", { ...draft, file: { size: file.size, type: file.type } }, viewerId, signal);
            uploadId = response.uploadId;
            return response;
        },
        confirm(id: string, signal: AbortSignal) { return api.post<PublishedMaterial>(`/api/material-uploads/${encode(id)}/confirm`, undefined, { signal }); },
        async cancel() { if (uploadId) await api.delete(`/api/material-uploads/${encode(uploadId)}`); }
    };
}