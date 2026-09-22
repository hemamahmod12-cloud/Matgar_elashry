# ترحيل storeData إلى Collections

أضيفت أداة `scripts/migrate-store-data.cjs` لترحيل البيانات القديمة من `storeData/{key}` إلى `stores/main/{collection}/{id}` دون حذف المصدر القديم.

## المتطلبات

ثبت Firebase Admin SDK خارج بيئة المتصفح:

```bash
npm install firebase-admin
```

ثم جهز حساب خدمة بصلاحية Firestore مناسبة، ولا تضع ملفه في Git:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/service-account.json"
export FIREBASE_PROJECT_ID="story-market-35565"
export FIREBASE_STORE_ID="main"
```

## الوضع الافتراضي الآمن

الأمر التالي يقرأ البيانات ويتحقق منها ويكتب ملخصًا ونسخة محلية في `migration-artifacts/`، لكنه لا يكتب أي Collection جديدة:

```bash
node scripts/migrate-store-data.cjs
```

راجع الملفات التالية قبل التطبيق:

```text
migration-artifacts/migration-summary.json
migration-artifacts/legacy-snapshot.json
```

## التطبيق الفعلي

لا يبدأ التطبيق إلا بوجود العلامتين معًا:

```bash
ALLOW_PRODUCTION_MIGRATION=YES \
node scripts/migrate-store-data.cjs --apply
```

الأداة قابلة لإعادة التشغيل، وتمنع إعادة تطبيق نفس النسخة بعد وجود marker مكتمل في:

```text
stores/main/_migrations/legacy-store-data-v1
```

لا تحذف `storeData` بعد الترحيل. يجب تعديل التطبيق واختبار القراءة والبيع والاسترجاع والتزامن قبل تعطيل المصدر القديم.

## حالة التنفيذ

تم تجهيز الأداة والتوثيق فقط. لم تُقرأ بيانات Firebase ولم تُكتب Collections ولم تُنفذ عملية إنتاج؛ لا توجد بيانات اعتماد Firebase Admin في مساحة العمل، كما أن التطبيق الحالي يحتاج إلى طبقة قراءة مزدوجة قبل تحويل الكتابة بالكامل إلى الهيكل الجديد.

## قواعد الهيكل الجديد

تمت إضافة `firestore.rules.next` كنسخة غير نشطة لقواعد Collections الجديدة. لا تعدّل `firebase.json` لتشير إليها قبل اكتمال ترحيل البيانات وتعديل التطبيق، لأن القواعد الحالية في `firestore.rules` هي التي تحافظ على تشغيل نموذج `storeData` القديم.

بعد اكتمال الترحيل وتعديل التطبيق، اختبر القواعد الجديدة عبر Emulator، ثم استبدل اسم الملف بأمر تغيير واضح وراجعه قبل النشر.

## خدمة البيع والاسترجاع الموثوقة

تمت إضافة `functions/src/index.js` وفيه `processSaleRequest` و`processReturnRequest`. كل عملية تتحقق من المستخدم، وتعيد قراءة المنتج والمخزون والسعر من Firestore، ثم تنفذ إنشاء الفاتورة وتحديث المخزون والعداد وحركة المخزون وسجل المراجعة داخل Transaction واحدة.

أضيف `src/collections-repository.js` وجرى ربطه بالواجهة. مسار البيع الجديد موجود خلف `COLLECTIONS_BACKEND_ENABLED = false` في `index.html`، لذلك لم يتغير سلوك الإنتاج الحالي قبل اكتمال الترحيل والاختبار.

لا يجوز تحويل المفتاح إلى `true` إلا بعد إنشاء Collections الجديدة، ترحيل البيانات والتحقق منها، نشر Cloud Functions، تعديل مزامنة المنتجات والمستخدمين إلى المسارات الجديدة، واختبار البيع والاسترجاع على Emulator.

## بوابة تفعيل الإنتاج

أضيفت `scripts/activate-collections-production.cjs`، وهي لا تفعل `COLLECTIONS_BACKEND_ENABLED` إلا بعد وجود marker ترحيل مكتمل ووجود مستندات في Collections الأساسية (`products`, `sales`, `users`, `stockMoves`). عند فشل أي شرط تبقى الواجهة على المسار القديم.

أضيف `.github/workflows/deploy-functions.yml` للنشر اليدوي فقط. يجب إنشاء GitHub Actions secret باسم `FIREBASE_SERVICE_ACCOUNT` يحتوي JSON لحساب خدمة Firebase، ثم تشغيل Workflow يدويًا من تبويب Actions. لم يتم وضع المفتاح في المستودع.
