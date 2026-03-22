import paho.mqtt.client as mqtt
import time
import random

# ==========================================
# ⚙️ การตั้งค่า MQTT Broker
# ==========================================
# ถ้าคุณรันสคริปต์นี้บนเครื่องเดียวกับที่รัน Docker ให้ใช้ "localhost" หรือ "127.0.0.1"
# ถ้ารันจากเครื่องอื่น ให้ใส่ IP ของเครื่อง Ubuntu (เช่น "192.168.0.x")
BROKER_ADDRESS = "192.168.0.40" 
BROKER_PORT = 1883

# รายชื่อเซ็นเซอร์ที่ต้องการจำลอง
SENSOR_IDS = ["SPK-001", "TES-001"]

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"✅ เชื่อมต่อ MQTT Broker ที่ {BROKER_ADDRESS} สำเร็จ!")
    else:
        print(f"❌ เชื่อมต่อล้มเหลว รหัสข้อผิดพลาด: {rc}")

# สร้างตัวแปร Client
client = mqtt.Client(client_id="Python_Mock_Sensor")
client.on_connect = on_connect

try:
    # เชื่อมต่อไปยัง Broker
    client.connect(BROKER_ADDRESS, BROKER_PORT, 60)
    client.loop_start() # เริ่ม Loop การทำงานของ MQTT ใน background
    
    print("🚀 เริ่มต้นจำลองการส่งข้อมูล... (กด Ctrl+C เพื่อหยุด)")
    
    while True:
        for sensor_id in SENSOR_IDS:
            # จำลองการสุ่มค่าต่างๆ
            distance_cm = random.randint(20, 150)        # ระยะน้ำ 20 - 150 cm
            battery_v = round(random.uniform(3.2, 4.2), 2) # แบตเตอรี่ 3.2 - 4.2 V
            rssi_dbm = random.randint(-110, -50)         # สัญญาณ -110 ถึง -50 dBm
            
            # 1. ส่งข้อมูลระยะทาง (Distance)
            topic_distance = f"sensors/{sensor_id}/distance"
            client.publish(topic_distance, str(distance_cm))
            
            # 2. ส่งข้อมูลแบตเตอรี่ (Battery)
            topic_battery = f"sensors/{sensor_id}/battery"
            client.publish(topic_battery, str(battery_v))
            
            # 3. ส่งข้อมูลสัญญาณ (RSSI)
            topic_rssi = f"sensors/{sensor_id}/rssi"
            client.publish(topic_rssi, str(rssi_dbm))
            
            print(f"[📤 ส่งข้อมูล] {sensor_id} | ระดับน้ำ: {distance_cm} cm | แบต: {battery_v} V | สัญญาณ: {rssi_dbm} dBm")
            
            time.sleep(1) # หน่วงเวลาเล็กน้อยก่อนส่งตัวถัดไป
            
        print("-" * 50)
        time.sleep(5) # รอ 5 วินาที ก่อนส่งข้อมูลรอบใหม่ทั้งหมด

except KeyboardInterrupt:
    print("\n🛑 หยุดการทำงานโดยผู้ใช้")
except Exception as e:
    print(f"\n❌ เกิดข้อผิดพลาด: {e}")
finally:
    client.loop_stop()
    client.disconnect()
    print("🔌 ปิดการเชื่อมต่อเรียบร้อย")