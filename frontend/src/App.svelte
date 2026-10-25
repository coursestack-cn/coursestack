<script lang="ts">
    // Temporary connectivity probe: admin login against the backend through the Vite proxy.
    let password = $state("");
    let output = $state("");

    async function call(path: string, init?: RequestInit) {
        try {
            const response = await fetch(path, init);
            output = `${init?.method ?? "GET"} ${path} -> ${response.status}\n${await response.text()}`;
        } catch (error) {
            output = `${path} failed: ${error}`;
        }
    }

    function login(event: SubmitEvent) {
        event.preventDefault();
        call("/api/auth/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password })
        });
    }
</script>

<main>
    <h1>CourseStack</h1>
    <p>面向校内课程的资料共享与问答平台。</p>

    <form onsubmit={login}>
        <input type="password" placeholder="管理员密码" bind:value={password} />
        <button type="submit">管理员登录</button>
        <button type="button" onclick={() => call("/api/health")}>健康检查</button>
        <button type="button" onclick={() => call("/api/auth/me")}>当前用户</button>
        <button type="button" onclick={() => call("/api/auth/logout", { method: "POST" })}>退出</button>
    </form>

    <pre>{output}</pre>
</main>