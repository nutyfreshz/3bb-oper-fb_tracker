# Facebook Group Operation Tracker

เวอร์ชัน Databricks Apps สำหรับกรอก SocialAPIs API key แล้วกด **Query 7 วัน** ได้จากหน้าเว็บ แอปใช้ Node.js 22 และเก็บโพสต์กับสถานะ `Pending` / `Fixed` ในเบราว์เซอร์ที่ใช้งาน การเปิดจากเบราว์เซอร์อื่นจะได้ข้อมูลคนละชุด

## Deploy บน Databricks Apps

1. ใน Databricks Apps เลือก **Create app → Create custom app → Configure Git** แล้วใช้ repo นี้และ branch `databricks-standalone`
2. กด **Deploy** โดยเว้น **App resources** ว่างได้ `app.yaml` ใช้ค่า runtime ที่ Databricks สร้างให้
3. เปิด App URL ด้วยบัญชีที่มีสิทธิ์ **Can Use** จากนั้นกรอก SocialAPIs API key แล้วกด **Query 7 วัน** หรือกด **ทดสอบ 3 โพสต์** เพื่อลองหนึ่งหน้าก่อน

คีย์จะอยู่ในหน่วยความจำของแท็บจนกว่าจะรีเฟรชหรือปิดแท็บ ส่วนโพสต์กับสถานะจะอยู่ในเบราว์เซอร์เดิมจนกว่าจะล้างข้อมูลของเว็บไซต์ หาก workspace จำกัด outbound traffic ให้แอปเข้าถึง `mcp.socialapis.io` และ `api.socialapis.io` สำหรับ Query และตรวจบัญชีเมื่อ API ตอบผิดปกติ

## ทดสอบในเครื่อง

- `npm run dev` เปิดเว็บทดสอบพร้อมข้อมูลจำลอง ใช้คีย์ `qa-key`
- `npm run build` แล้ว `npm start -- --local` เปิดแอปบน `http://127.0.0.1:8000` เพื่อใช้คีย์ SocialAPIs จริง

[Deploy a Databricks app](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/deploy)
