# Facebook Group Operation Tracker

เว็บติดตามโพสต์และสถานะ `Pending` / `Fixed` สำหรับทีม รุ่นนี้ใช้ Node.js 22 บน Databricks Apps และเก็บข้อมูลร่วมกันใน Lakebase Autoscaling (PostgreSQL)

## Deploy บน Databricks Apps

1. เชื่อม GitHub repo กับ Databricks App ผ่าน **Configure Git** เลือก branch `main` หรือระบุ commit ที่จะ deploy สำหรับ Public repo ให้กด **Deploy** เองเมื่อมีการเปลี่ยนโค้ด
2. เพิ่ม Lakebase Autoscaling เป็น **App resource** แล้วเลือก project, branch และ database สำหรับ Tracker Databricks จะตั้ง `PGHOST`, `PGDATABASE`, `PGUSER` และค่าการเชื่อมต่อให้แอป
3. ใน Lakebase เปิด branch → **Computes** → **Get ID** → **Copy resource name** แล้วเอาค่ามาแทน placeholder ของ `ENDPOINT_NAME` ใน `app.yaml` บน branch ที่จะ deploy
4. เพิ่ม Secret เป็น App resource โดยใช้ resource key `socialapis-key` ให้ตรงกับ `app.yaml` แล้ว deploy แอปจะสร้างตาราง `facebook_posts` ครั้งแรกใน PostgreSQL ที่เลือก
5. ให้ผู้ใช้หรือกลุ่มที่ต้องการเข้าถึงสิทธิ์ **Can Use** บน Databricks App สมาชิกใช้บัญชีของตัวเองเข้าเว็บ ส่วนแอปใช้ service principal เขียนฐานข้อมูล

หาก workspace จำกัด outbound traffic ให้ตรวจว่าแอปเข้าถึง `mcp.socialapis.io` ได้ และให้เข้าถึง `api.socialapis.io` ด้วยสำหรับการตรวจเครดิตเมื่อ upstream ตอบผิดปกติ API key อยู่ใน Databricks secret

## ย้ายโพสต์จาก Tracker เดิม

หลังเปิดแอปสำเร็จครั้งแรก ให้ใช้ SQL editor ของ Lakebase เชื่อมฐานข้อมูลเดียวกับแอปแล้วรันไฟล์ `tracker-posts-migration.sql` ใช้บัญชีที่เขียนตาราง `facebook_posts` ได้ ไฟล์รักษาเวลาโพสต์และสถานะเดิม และรันซ้ำได้โดยข้ามรหัสที่มีอยู่แล้วในปลายทาง

หากต้องสร้างไฟล์ SQL จากข้อมูลล่าสุด ให้เข้าสู่ระบบ Tracker เดิม แล้วเปิดเส้นทาง `/api/posts?days=all` บนโดเมนเดิมและบันทึก JSON เป็น `page-1.json` ถ้า `next` มีค่า ให้เปิด URL เดิมโดยต่อ `&before=` ตามด้วยค่า `next` บันทึกทุกหน้าตามลำดับจน `next` เป็น `null` แล้วรัน

```bash
npm run prepare:migration -- tracker-posts-migration.sql /path/to/page-1.json
```

ถ้ามีหลายหน้าให้ตามด้วยไฟล์ JSON แต่ละหน้า เก็บไฟล์ JSON และ SQL สำหรับย้ายข้อมูลไว้นอก Git repo

ตรวจจำนวนโพสต์ตามสถานะในฐานข้อมูล

```sql
SELECT fix_status, COUNT(*) FROM facebook_posts GROUP BY fix_status ORDER BY fix_status;
```

เปิด Tracker แล้วเลือก **ทุกวันที่** เพื่อดูโพสต์จาก snapshot ลองเปลี่ยนสถานะหนึ่งโพสต์และกด **รีเฟรชข้อมูลทีม** จากอีกเบราว์เซอร์ จากนั้นกด Query ทดสอบหลังยืนยันว่า workspace อนุญาตการเชื่อม SocialAPIs

## ทดสอบ

- `npm install` และ `npm run build` สำหรับ build
- `npm run dev` สำหรับเปิด preview ด้วยโพสต์ตัวอย่างและ SQLite ในหน่วยความจำ
- สำหรับทดสอบกับ PostgreSQL จริงจากเครื่องตัวเอง ให้ตั้ง `DATABASE_URL` เป็น connection string ของฐานทดสอบ แล้วรัน `npm start -- --local` โหมดนี้ฟังเฉพาะ loopback และใช้ตัวตนจำลอง

เอกสารประกอบ

- [Deploy a Databricks app](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/deploy)
- [Add a Lakebase resource to a Databricks app](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/lakebase)
- [Find the Lakebase compute resource name](https://learn.microsoft.com/en-us/azure/databricks/oltp/projects/tutorial-databricks-apps-autoscaling)
