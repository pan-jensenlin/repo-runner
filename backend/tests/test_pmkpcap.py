#!/usr/bin/env python3
"""
Intro:
    This script pmkpcap.py provides a Python based script to generated pcap files from raw C Array L7 payload.
    The input C Array payload file should maintain the format from Wireshark software.
Copyright:
    Palo Alto Networks, Developer Internal Use Only
Author:
    Originally developed by Jiangnan Li at the App-ID team (jiali@paloaltonetworks.com). Please feel free to contact
    if there are any advices or bugs.
Date:
    Aug/28/2022.
"""
import os
import time
import copy
import re
import argparse
import random
import scapy.all as scapy


class SessionPcap:
    """
        creating a pcap that contains a complete session of the given input.
        create one session only
        direction 1 means cts, while direction 0 means stc
    """

    def __init__(self, cip, cp, sip, sp, payload, protocol):
        """client ip, client port, server ip, server port, l7 payload, protocol (tcp or udp)"""
        self.CLIENT_IP = cip
        self.CLIENT_PORT = cp
        self.SERVER_IP = sip
        self.SERVER_PORT = sp
        self.L7PAYLOAD = payload
        self.L4PROTOCOL = protocol
        self.C2S_ETHER_BASE = scapy.Ether(dst="00:1c:23:10:f8:f1", src="00:1b:17:01:10:20", type=int("0x0800", 16))
        self.S2C_ETHER_BASE = scapy.Ether(dst="00:1b:17:01:10:20", src="00:1c:23:10:f8:f1", type=int("0x0800", 16))
        self.C2S_IP_ID = int.from_bytes(os.urandom(2), "big", signed=False)
        self.S2C_IP_ID = int.from_bytes(os.urandom(2), "big", signed=False)
        self.C2S_TCP_SEQ = int.from_bytes(os.urandom(4), "big", signed=False)
        self.S2C_TCP_SEQ = int.from_bytes(os.urandom(4), "big", signed=False)
        self.C2S_TCP_ACK = 0
        self.S2C_TCP_ACK = 0
        self.packet_list = []
        self.c_array_payload_parsing()

    def c_array_payload_parsing(self):
        dir_payload_list = []
        self.L7PAYLOAD = self.L7PAYLOAD.replace("\n", '').replace(" ", '').split(";")
        self.L7PAYLOAD.remove('')
        for message in self.L7PAYLOAD:
            dire = re.search("r[01]_", message).group()[1:2]
            stripe_pkt_string = re.sub("/\*.*\*/", '', message)
            payload = re.search("{.*}", stripe_pkt_string).group()[1:-1]
            orignal_raw_payload = payload.replace("0x", '').replace(",", '')
            # hex string must be even number
            if len(orignal_raw_payload) % 2 != 0:
                print("!!WRONG ARRAY FORMAT!!")
                exit()
            # do the TCP/UDP segment here
            payload_segments = self.large_packet_segment(orignal_raw_payload)

            """the peer0_0 in wireshark C array means c2s while peer1_0 means s2c, 
            which are opposite to our definition (in SML decoder), shift it here"""

            for segment in payload_segments:
                dir_payload_list.append((int(dire) ^ 1, segment))

        self.L7PAYLOAD = dir_payload_list

    def large_packet_segment(self, raw_payload):
        """do the large packet segment, since some replay programs do not support large packet
        the input raw_payload should be hex string, return is also hex string
        the MSS for TCP is 1460 bytes, while MSS for UDP is 1472 bytes"""

        msshex_tcp = 1460 * 2
        msshex_udp = 1472 * 2

        if self.L4PROTOCOL == "tcp":
            if len(raw_payload) > msshex_tcp:
                print("packet size is larger than TCP MSS, split the packet into segments of " + str(int(msshex_tcp/2)) + " bytes")
                segment_payload = [raw_payload[i:i + msshex_tcp] for i in range(0, len(raw_payload), msshex_tcp)]
            else:
                segment_payload = [raw_payload]
        elif self.L4PROTOCOL == "udp":
            if len(raw_payload) > msshex_udp:
                print("packet size is larger than UDP MSS, split the packet into segments of " + str(int(msshex_udp/2)) + " bytes")
                segment_payload = [raw_payload[i:i + msshex_udp] for i in range(0, len(raw_payload), msshex_udp)]
            else:
                segment_payload = [raw_payload]
        else:
            segment_payload = []
            print("WRONG PROTOCOL, MUST BE TCP OR UDP")
            exit()

        return segment_payload

    def make_ip_header(self, direction):
        """
            NOTE: ethernet base will be directly added in this function, returns Ethernet|IP Header
            the IP identifier number is handled within this function
        """
        if direction:
            cts_ip_packet = copy.deepcopy(self.C2S_ETHER_BASE)/scapy.IP(src=self.CLIENT_IP, dst=self.SERVER_IP, id=self.C2S_IP_ID)
            self.C2S_IP_ID += 1
            return cts_ip_packet
        else:
            stc_ip_packet = copy.deepcopy(self.S2C_ETHER_BASE)/scapy.IP(src=self.SERVER_IP, dst=self.CLIENT_IP, id=self.S2C_IP_ID)
            self.S2C_IP_ID += 1
            return stc_ip_packet

    def make_tcp_header(self, tcp_flags, direction):
        """
            the tcp sequence and ack number are handled in upper layer functions
            this function returns the Ethernet|IP header|TCP header
        """
        if direction:
            return self.make_ip_header(direction)/scapy.TCP(sport=self.CLIENT_PORT, dport=self.SERVER_PORT, flags=tcp_flags, seq=self.C2S_TCP_SEQ, ack=self.C2S_TCP_ACK)
        else:
            return self.make_ip_header(direction)/scapy.TCP(sport=self.SERVER_PORT, dport=self.CLIENT_PORT, flags=tcp_flags, seq=self.S2C_TCP_SEQ, ack=self.S2C_TCP_ACK)

    def make_udp_header(self, direction):
        """ this function returns the Ehernet/IP header/UDP header"""
        if direction:
            return self.make_ip_header(direction)/scapy.UDP(sport=self.CLIENT_PORT, dport=self.SERVER_PORT)
        else:
            return self.make_ip_header(direction)/scapy.UDP(sport=self.SERVER_PORT, dport=self.CLIENT_PORT)

    def add_tcp_handshake(self):
        handshake_syn = self.make_tcp_header(tcp_flags='S', direction=1)
        self.C2S_TCP_SEQ += 1
        self.S2C_TCP_ACK = self.C2S_TCP_SEQ
        handshake_syn_ack = self.make_tcp_header(tcp_flags='SA', direction=0)
        self.S2C_TCP_SEQ += 1
        self.C2S_TCP_ACK = self.S2C_TCP_SEQ
        handshake_ack = self.make_tcp_header(tcp_flags='A', direction=1)
        self.packet_list.extend([handshake_syn, handshake_syn_ack, handshake_ack])

    def add_tcp_close(self):
        if len(self.packet_list) < 3:
            print("WRONG HANDSHAKE INFO!")
            exit()
        else:
            """ the close request is initiated by the server side"""
            tcp_close_fin_1 = self.make_tcp_header(tcp_flags="FA", direction=0)
            self.S2C_TCP_SEQ += 1
            self.C2S_TCP_ACK += 1
            tcp_close_ack_1 = self.make_tcp_header(tcp_flags="A", direction=1)
            tcp_close_fin_2 = self.make_tcp_header(tcp_flags="FA", direction=1)
            self.S2C_TCP_ACK += 1
            tcp_close_ack_2 = self.make_tcp_header(tcp_flags="A", direction=0)
            self.packet_list.extend([tcp_close_fin_1, tcp_close_ack_1, tcp_close_fin_2, tcp_close_ack_2])

    def build_tcp_session(self):
        self.add_tcp_handshake()

        # parsing the messages
        for i in list(range(len(self.L7PAYLOAD))):
            cur_dir = self.L7PAYLOAD[i][0]
            cur_load = bytes.fromhex(copy.deepcopy(self.L7PAYLOAD[i][1]))
            if i == 0:
                """ the first packet with payload is relatively special, treat it here"""
                if cur_dir:
                    cur_packet = self.make_tcp_header(tcp_flags='PA', direction=1)/scapy.Raw(load=cur_load)
                    self.C2S_TCP_SEQ += len(cur_load)
                    self.S2C_TCP_ACK = self.C2S_TCP_SEQ
                else:
                    cur_packet = self.make_tcp_header(tcp_flags='PA', direction=0)/scapy.Raw(load=cur_load)
                    self.S2C_TCP_SEQ += len(cur_load)
                    self.C2S_TCP_ACK = self.S2C_TCP_SEQ
                self.packet_list.append(cur_packet)
            else:
                if cur_dir == self.L7PAYLOAD[i - 1][0]:
                    """
                        if last packet with payload is also in same direction as the current packet, 
                        we need to simulate an ACK from the opposite direction.
                    """
                    sim_ack_packet = self.make_tcp_header(tcp_flags="A", direction=(cur_dir ^ 1))
                    self.packet_list.append(sim_ack_packet)

                cur_packet = self.make_tcp_header(tcp_flags="PA", direction=cur_dir) / scapy.Raw(load=cur_load)

                # handle the sequence and ack issue here
                if cur_dir:
                    self.C2S_TCP_SEQ += len(cur_load)
                    self.S2C_TCP_ACK = self.C2S_TCP_SEQ
                else:
                    self.S2C_TCP_SEQ += len(cur_load)
                    self.C2S_TCP_ACK = self.S2C_TCP_SEQ

                self.packet_list.append(cur_packet)

        self.add_tcp_close()

    def build_udp_session(self):
        #  parsing the messages
        for i in list(range(len(self.L7PAYLOAD))):
            cur_dir = self.L7PAYLOAD[i][0]
            cur_load = bytes.fromhex(copy.deepcopy(self.L7PAYLOAD[i][1]))
            cur_packet = self.make_udp_header(direction=cur_dir)/scapy.Raw(load=cur_load)
            self.packet_list.append(cur_packet)

    def write_to_pcap(self, pcap_name):
        if self.L4PROTOCOL == "tcp":
            self.build_tcp_session()
        elif self.L4PROTOCOL == "udp":
            self.build_udp_session()
        else:
            print("WRONG PROTOCOL, MUST BE TCP OR UDP")

        """ add timestamp with time interval 0.02s (50pps) """
        start_time = time.time()
        for i in list(range(len(self.packet_list))):
            self.packet_list[i].time = start_time + 0.02 * i

        scapy.wrpcap(pcap_name, scapy.PacketList(self.packet_list))


pmkpcap_description = "pmkpcak is a Python3-based tool to generate pcap from L7 payload in C array format " \
                      "(same as Wireshark Output). " \
                      "The tool is for Palo Alto Network engineer internal use only. " \
                      "Please contact the developer Jiangnan Li (jiali@paloaltonetworks.com) " \
                      "if you found any bugs or had any advices."

pmkpcap_change_log = "\npmkpcap v1.03. fixed the pcap file timestamp issue, now the time interval between packets is 0.02s" \
                     "\n+-+-+-++-+-+-+-+-+-+-+-+-+-+-+\n" \
                     "pmkpcap v1.02. added TCP/UDP segment feature since some replay software has MSS requirements. " \
                     "currently the MSS for TCP is 1480 bytes while MSS for UDP is 1472 bytes" \
                     "\n+-+-+-++-+-+-+-+-+-+-+-+-+-+-+\n" \
                     "pmkpcap v1.01. add this change log feature; improved the wireshark \* Packet XXX *\ issue. " \
                     "whether such strings are presented at the C arrays is OK for this version." \
                     "\n+-+-+-++-+-+-+-+-+-+-+-+-+-+-+\n" \
                     "pmkpcap v1, create this script\n"

pmkparser = argparse.ArgumentParser(description=pmkpcap_description)

pmkparser.add_argument('-si', '--source_ip', type=str, default="192.168.1.111", help="the source (client) IP address. default value is 192.168.1.111")
pmkparser.add_argument('-sp', '--source_port', type=str, default=str(random.randint(40000, 64000)), help="the source (client) port, default value is randomly generated between 40000 and 64000")
pmkparser.add_argument('-di', '--destination_ip', type=str, default="192.168.1.222", help="the destination (server) IP address. default value is 192.168.1.222")
pmkparser.add_argument('-dp', '--destination_port', type=str, default="443", help="the source (client) port, default value is 443")
pmkparser.add_argument('-f', '--input_filename', type=str, default="pmk-input.txt", help="the input file that stores the L7 payload C array. default value is pmk-input.txt")
pmkparser.add_argument('-o', '--output_pcap_name', type=str, default="pmk-output.pcap", help="the name of output pcap file. default value is pmk-output.pcap")
pmkparser.add_argument('-p', '--protocol', type=str, default="tcp", choices=['tcp', 'udp'], help="transportation layer protcol, must be tcp or udp. default value is tcp")
pmkparser.add_argument('-cl', '--change_log', default=0, help="show the change log, usage: pmkpcap -cl 1")

pmkargs = pmkparser.parse_args()

if pmkargs.change_log:
    print(pmkpcap_change_log)
    exit()

sour_ip = pmkargs.source_ip
sour_port = int(pmkargs.source_port)
dest_ip = pmkargs.destination_ip
dest_port = int(pmkargs.destination_port)
input_file = pmkargs.input_filename
output_file = pmkargs.output_pcap_name
trans_protocol = pmkargs.protocol


created_session = SessionPcap(cip=sour_ip, cp=sour_port, sip=dest_ip, sp=dest_port, payload=open(input_file).read(), protocol=trans_protocol)
created_session.write_to_pcap(output_file)

print("\n pcap file " + output_file + " has been created!\n")

