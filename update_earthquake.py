import requests
import re
import json
import pandas as pd
from bs4 import BeautifulSoup

def parse_item_data(item):
    """
    ฟังก์ชันย่อยสำหรับแกะข้อมูลและสกัดพิกัดจากแต่ละ Item 
    เพื่อป้องกันปัญหา Syntax Error ซ้อนบล็อก
    """
    try:
        lat, lon = None, None
        
        # แผน ก: ตรวจสอบแท็กพิกัดตรงๆ
        lat_tag = item.find('geo:lat') or item.find('lat')
        lon_tag = item.find('geo:long') or item.find('long')
        
        if lat_tag and lon_tag:
            lat = float(lat_tag.text.strip())
            lon = float(lon_tag.text.strip())
        
        # แผน ข: สกัดพิกัดจากข้อความในแท็ก <description> (CDATA) ด้วย Regex
        if lat is None or lon is None:
            desc_tag = item.find('description')
            if desc_tag:
                desc_text = desc_tag.text
                lat_match = re.search(r'Lat\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                lon_match = re.search(r'Long\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                if lat_match and lon_match:
                    lat = float(lat_match.group(1))
                    lon = float(lon_match.group(1))
                    
        # หากสกัดพิกัดไม่สำเร็จให้ส่งค่ากลับเป็น None ทันที
        if lat is None or lon is None:
            return None
            
        # สกัด Attributes อื่นๆ 
        title = item.find('title').text.strip() if item.find('title') else "ไม่ระบุสถานที่"
        mag = item.find('tmd:magnitude') or item.find('magnitude')
        depth = item.find('tmd:depth') or item.find('depth')
        time_utc = item.find('tmd:time') or item.find('time')
        comments = item.find('comments')
        
        record = {
            "Location": title,
            "Magnitude": float(mag.text.strip()) if mag else 0.0,
            "Depth_km": float(depth.text.strip()) if depth else 0.0,
            "Time_UTC": time_utc.text.strip() if time_utc else "",
            "Comments": comments.text.strip() if comments else "",
            "Latitude": lat,
            "Longitude": lon
        }
        
        # แปลงเวลา UTC เป็นเวลาประเทศไทย (+7 ชั่วโมง) ด้วย Pandas
        if record["Time_UTC"]:
            try:
                utc_time = pd.to_datetime(record["Time_UTC"]).tz_localize('UTC')
                thai_time = utc_time.tz_convert('Asia/Bangkok')
                record["Time_TH"] = thai_time.strftime('%Y-%m-%d %H:%M:%S')
            except:
                record["Time_TH"] = None
        else:
            record["Time_TH"] = None
            
        return record

    except Exception:
        return None


def fetch_tmd_earthquake():
    """
    ฟังก์ชันหลักในการดึงข้อมูลจากกรมอุตุฯ และรวมรวบเป็นโครงสร้างไฟล์ GeoJSON
    """
    rss_url = "https://earthquake.tmd.go.th/feed/rss_tmd.xml"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        # 1. ส่งคำขอดึงข้อมูล XML
        response = requests.get(rss_url, headers=headers, timeout=30)
        if response.status_code != 200:
            print(f"[-] ไม่สามารถเชื่อมต่อ RSS Feed ได้ รหัสข้อผิดพลาด: {response.status_code}")
            return
            
        xml_data = response.content
        soup = BeautifulSoup(xml_data, features="xml")
        items_list = soup.find_all('item')
        
        geojson_features = []
        
        # 2. วนลูปส่งไปแกะค่าในฟังก์ชันย่อย
        for item in items_list:
            record = parse_item_data(item)
            
            # หากแกะข้อมูลผ่านและได้พิกัดครบ ให้แปลงเป็นองค์ประกอบของ GeoJSON Feature
            if record is not None:
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [record["Longitude"], record["Latitude"]]
                    },
                    "properties": {
                        "Location": record["Location"],
                        "Magnitude": record["Magnitude"],
                        "Depth_km": record["Depth_km"],
                        "Time_UTC": record["Time_UTC"],
                        "Time_TH": record["Time_TH"],
                        "Comments": record["Comments"]
                    }
                }
                geojson_features.append(feature)
                
        # 3. ตรวจสอบปริมาณข้อมูล
        if not geojson_features:
            print("[-] ไม่พบข้อมูลเหตุการณ์ที่สกัดพิกัดได้จาก RSS Feed")
            return
            
        # ประกอบขึ้นเป็นภาพรวมโครงสร้าง GeoJSON Collection
        geojson_data = {
            "type": "FeatureCollection",
            "features": geojson_features
        }
        
        # 4. เขียนไฟล์ผลลัพธ์ลงระบบเครื่องจำลอง
        output_file = "earthquake_latest.geojson"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(geojson_data, f, ensure_ascii=False, indent=4)
            
        print(f"[+] สำเร็จ! ดึงข้อมูลและสร้างไฟล์ {output_file} เรียบร้อยแล้ว จำนวน {len(geojson_features)} เหตุการณ์")
        
    except Exception as e:
        print(f"[-] เกิดข้อผิดพลาดในระบบประมวลผลหลัก: {str(e)}")
        raise e


if __name__ == "__main__":
    fetch_tmd_earthquake()
