import { sql } from 'drizzle-orm';
import { type Ctx } from '../discussions/types.ts';
import { contentDto, publicDetail, visibleContent } from '../discussions/service.ts';
import { createDatabase } from '../db/index.ts';
import { editPermission, management } from '../permissions.ts';
import { HttpError, listResult, queryPage, type page } from '../http.ts';
import { materialId, previewKind, urlId } from './validation.ts';

export type VersionRow = {
    material_id: string; version: number; storage_key: string; size: number; mime: string; uploaded_by: string; created_at: number;
};
export function versionDto(row: VersionRow) {
    const base = `/api/materials/${encodeURIComponent(urlId(row.material_id))}/versions/${row.version}`;
    return { version: row.version, size: row.size, mime: row.mime,
        uploadedBy: row.uploaded_by, createdAt: row.created_at,
        previewKind: previewKind(row.mime), previewUrl: previewKind(row.mime) ? `${base}/preview` : null,
        downloadUrl: `${base}/download` };
}
export async function courseIdentity(c: Ctx, id: string) {
    const row = await createDatabase(c.env.DB).get<{ id: string }>(sql`SELECT id FROM courses WHERE id=${id}`);
    if (!row) throw new HttpError(404, 'COURSE_NOT_FOUND', '课程不存在');
    return row.id;
}
export async function materialContent(c: Ctx, id: string) {
    return visibleContent(c, materialId(id), 'material');
}
export async function selectedVersion(c: Ctx, id: string, version?: number) {
    const row = await createDatabase(c.env.DB).get<VersionRow>(sql`SELECT * FROM file_versions
        WHERE material_id=${id} ${version === undefined ? sql`` : sql`AND version=${version}`}
        ORDER BY version DESC LIMIT 1`);
    if (!row && version !== undefined) throw new HttpError(404, 'FILE_VERSION_UNAVAILABLE', '文件版本不存在或不可用');
    return row ?? null;
}
export async function versionPage(c: Ctx, id: string, p: ReturnType<typeof page>) {
    const { rows, total } = await queryPage<VersionRow>(c, p, sql`SELECT * FROM file_versions WHERE material_id=${id} ORDER BY version DESC`);
    return listResult(rows.map(versionDto), p, total);
}
export async function materialDetail(c: Ctx, id: string, version?: number) {
    const content = await materialContent(c, id);
    const [detail, latest, selected, versions] = await Promise.all([
        publicDetail(c, content.id), selectedVersion(c, content.id),
        version === undefined ? Promise.resolve(null) : selectedVersion(c, content.id, version),
        versionPage(c, content.id, { page: 1, pageSize: 50, offset: 0 }),
    ]);
    const a = c.get('actor');
    const permissions = a ? await createDatabase(c.env.DB).get<{ edit: number; manage: number }>(sql`SELECT
        ${editPermission(a, sql`${content.course_id}`, sql`${content.author_id}`)} AS edit,
        ${management(a, sql`${content.course_id}`)} AS manage`) : null;
    return { ...detail, latestVersion: latest ? versionDto(latest) : null,
        selectedVersion: (selected ?? latest) ? versionDto((selected ?? latest)!) : null, versions,
        permissions: { canEdit: !!permissions?.edit, canUploadVersion: !!permissions?.edit, canDeleteVersion: !!permissions?.edit, canManage: !!permissions?.manage,
            requiresLoginForFile: !a } };
}
export async function withMaterialVersions(c: Ctx, items: ReturnType<typeof contentDto>[]) {
    const ids = items.filter(item => item.kind === 'material').map(item => item.id);
    if (!ids.length) return items;
    const versions = await createDatabase(c.env.DB).all<VersionRow>(sql`SELECT f.* FROM file_versions f
        WHERE f.material_id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)})
        AND NOT EXISTS(SELECT 1 FROM file_versions newer WHERE newer.material_id=f.material_id AND newer.version>f.version)`);
    const latest = new Map(versions.map(row => [row.material_id, versionDto(row)]));
    return items.map(item => item.kind === 'material' ? { ...item, latestVersion: latest.get(item.id) ?? null } : item);
}