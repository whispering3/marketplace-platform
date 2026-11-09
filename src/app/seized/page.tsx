export default function SeizedTrap() {
  return (
    <div style={{
      backgroundColor: "#050505",
      color: "#ddd",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Arial, sans-serif",
      textAlign: "center",
      padding: "20px"
    }}>
      <div style={{
        maxWidth: "620px",
        border: "1px solid #5f1f1f",
        padding: "32px",
        backgroundColor: "#120707"
      }}>
        <h1 style={{ fontSize: "32px", margin: "0 0 20px 0", color: "#ff6b6b", fontWeight: "bold" }}>
          ACCESS BLOCKED
        </h1>

        <p style={{ fontSize: "15px", lineHeight: "1.6", color: "#bbb", marginBottom: "24px" }}>
          This request matched a protected route and was intentionally denied. Return to the verified entry point before continuing.
        </p>

        <div style={{ backgroundColor: "#050505", color: "#ffb4b4", padding: "14px", fontSize: "13px", fontFamily: "monospace", marginBottom: "20px" }}>
          STATUS: BLOCKED_ROUTE
        </div>

        <a href="/" style={{ color: "#f26822", fontSize: "13px", textDecoration: "none" }}>Return to gateway</a>
      </div>

      <div style={{ marginTop: "32px", color: "#555", fontSize: "11px" }}>
        Private marketplace access control
      </div>
    </div>
  );
}
