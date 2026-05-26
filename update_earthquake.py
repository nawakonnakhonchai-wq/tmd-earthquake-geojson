import requests
import re
import pandas as pd
import geopandas as gpd
from bs4 import BeautifulSoup
from shapely.geometry import Point

def fetch_tmd_earthquake():
    rss_url = "https://earthquake.tmd.go.th/feed/rss_tmd.xml"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        response = requests.get(rss_url, headers=headers, timeout=30)
        if response.status_code != 200:
            print(f"ไม่สามารถเชื่อมต่อ RSS Feed ได้ รหัสข้อผิดพลาด: {response.status_code}")
            return
            
        xml_data = response.content
        soup = BeautifulSoup(xml_data, features="xml")
        items_list = soup.find_all('item')
        parsed_records = []
        
        for item in items_list:
            try:
                lat, lon = None, None
                lat_tag = item.find('geo:lat') or item.find('lat')
                lon_tag = item.find('geo:long') or item.find('long')
                
                if lat_tag and lon_tag:
                    lat = float(lat_tag.text.strip())
                    lon = float(lon_tag.text.strip())
                
                if lat is None or lon is None:
                    desc_tag = item.find('description')
                    if desc_tag:
                        desc_text = desc_tag.text
                        lat_match = re.search(r'Lat\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                        lon_match = re.search(r'Long\.\s*([+-]?\d+\.\d+)', desc_text, re.IGNORECASE)
                        if lat_match and lon_match:
                            lat = float(lat_match.group(1))
                            lon = float(lon_match.group(1))
                            
                if lat is not None and lon is not None:
                    title = item.find('title').text.strip() if item.find('title') else "ไม่ระบุสถานที่"
                    mag = item.find('tmd:magnitude') or item.find('magnitude')
                    depth = item.find('tmd:depth') or item.find('depth')
                    time_utc = item.find('tmd:time') or item.find('time')
                    comments = item.find('comments')
                    
                    record = {
                        "Location": title,
                        "Magnitude": pd.to_numeric(mag.text.strip(), errors='coerce') if mag else 0.0,
                        "Depth_km": pd.to_numeric(depth.text.strip(), errors='coerce') if depth else 0.0,
                        "Time_UTC": time_utc.text.strip() if time_utc else "",
                        "Comments": comments.text.strip() if comments else "",
                        "Latitude": lat,
                        "Longitude": lon
                    }
                    
                    if record["Time_UTC"]:
                        try:
                            utc_time = pd.to_datetime(record["Time_UTC"]).tz_localize('UTC')
                            thai_time = utc_time.tz_convert('Asia/Bangkok')
                            record["Time_TH"] = thai_time.strftime('%Y-%m-%d %H:%M:%S')
                        except:
                            record["Time_TH"] = None
                    else:
                        record["Time_TH"] = None
                        
                    parsed_records.append(record)
            except Exception:
                continue
                
        df = pd.DataFrame(parsed_records)
        if df.empty:
            print("ไม่พบข้อมูลเหตุการณ์ใดๆ จาก RSS Feed")
            return
            
        df["Latitude"] = pd.to_numeric(df["Latitude"], errors='coerce')
        df["Longitude"] = pd.to_numeric(df["Longitude"], errors='coerce')
        df = df.dropna(subset=["Latitude", "Longitude"])
        
        geometry = [Point(xy) for xy in zip(df["Longitude"], df["Latitude"])]
        gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
        
        output_file = "earthquake_latest.geojson"
        gdf.to_file(output_file, driver="GeoJSON", encoding="utf-8")
        print(f"สำเร็จ! ดึงข้อมูลและสร้างไฟล์สำเร็จจำนวน {len(gdf)} เหตุการณ์")
        
    except Exception as e:
        print(f"เกิดข้อผิดพลาดระหว่างประมวลผล: {e}")

if __name__ == "__main__":
    fetch_tmd_earthquake()
